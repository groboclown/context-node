
#include "env-inl.h"
#include "node_internals.h"
#include "util-inl.h"
#include "base_object-inl.h"
#include "v8.h"
#include <vector>
#include <algorithm>

// FIXME DEBUG
#include <stdio.h>

namespace node {

using v8::Context;
using v8::FunctionCallbackInfo;
using v8::FunctionTemplate;
using v8::Integer;
using v8::Isolate;
using v8::Local;
using v8::MaybeLocal;
using v8::Object;
using v8::Persistent;
using v8::Promise;
using v8::PromiseHookType;
using v8::String;
using v8::Uint32;
using v8::Value;

namespace {

class ActivePromise {
public:
  ActivePromise(Environment* env, uint32_t promise_id, Local<Promise> promise, Local<Value> parent);
  ~ActivePromise();

  inline bool is_match(Local<Promise> promise) const { return promise_.Get(isolate_) == promise; }
  inline bool has_parent() const { return !parent_.IsEmpty(); }
  void add_match(Local<Value>& new_parent);

  inline uint32_t id() const { return promise_id_; }

  inline bool remove_match() { --active_count_; return active_count_ <= 0; };

  inline Local<Promise> promise() const { return promise_.Get(isolate_); }

  // only callable if has_parent() is true.
  inline Local<Promise> parent() const { return parent_.Get(isolate_); }

private:
  static void set_persistent_value(Isolate* isolate, Persistent<Promise>& persistent, const Local<Value>& local);
  static void set_persistent_promise(Isolate* isolate, Persistent<Promise>& persistent, const Local<Promise>& local);

  const uint32_t promise_id_;
  uint32_t active_count_;
  Persistent<Promise> promise_;
  Persistent<Promise> parent_;
  Isolate* const isolate_;
};


class PromiseContext: BaseObject {
 public:
  static void Initialize(Local<Object> target,
                         Local<Value> unused,
                         Local<Context> context);
  static void New(const FunctionCallbackInfo<Value>& args);
  static void Start(const FunctionCallbackInfo<Value>& args);
  static void Close(const FunctionCallbackInfo<Value>& args);
  static void GetCurrentPromiseId(const FunctionCallbackInfo<Value>& args);
  static void GetParentPromiseId(const FunctionCallbackInfo<Value>& args);

private:
  PromiseContext(Environment* env,
                 Local<Object> object);
  ~PromiseContext() override;

  static void promise_hook_func(PromiseHookType type,
                                Local<Promise> promise,
                                Local<Value> parent,
                                void* arg);

  void add_active_promise(Local<Promise> promise,
                          Local<Value> parent);
  bool remove_active_promise(Local<Promise> promise);
  void push_promise(Local<Promise> promise);
  bool pop_promise(Local<Promise> promise);

  // These methods return a loaned pointer.  The memory is still owned
  // by the active_promises_ list.  The memory should be considered
  // valid only from within the caller's function.
  ActivePromise* peek_promise();
  ActivePromise* get_parent(const ActivePromise* active_promise);
  ActivePromise* get_promise_for_id(const uint32_t promise_id);
  ActivePromise* get_for_promise(const Local<Promise> promise);

  std::vector<ActivePromise*> active_promises_;
  std::vector<uint32_t> promise_stack_;
  bool initialized_ = false;
  Local<Object> object_;
  uint32_t promise_count_ = 0;
};


void PromiseContext::Initialize(Local<Object> target,
                                Local<Value> unused,
                                Local<Context> context) {
  Environment* env = Environment::GetCurrent(context);

  auto promisecontext_string = FIXED_ONE_BYTE_STRING(env->isolate(), "PromiseContext");
  Local<FunctionTemplate> t = env->NewFunctionTemplate(New);
  t->InstanceTemplate()->SetInternalFieldCount(1);
  t->SetClassName(promisecontext_string);

  env->SetProtoMethod(t, "start", Start);
  env->SetProtoMethod(t, "close", Close);
  env->SetProtoMethod(t, "getCurrentPromiseId", GetCurrentPromiseId);
  env->SetProtoMethod(t, "getParentPromiseId", GetParentPromiseId);

  target->Set(promisecontext_string, t->GetFunction());
}


void PromiseContext::New(const FunctionCallbackInfo<Value>& args) {
  CHECK(args.IsConstructCall());
  Environment* env = Environment::GetCurrent(args);
  new PromiseContext(env, args.This());
}


void PromiseContext::Start(const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);

  PromiseContext* wrap;
  ASSIGN_OR_RETURN_UNWRAP(&wrap, args.Holder());
  CHECK_EQ(wrap->initialized_, false);

  env->AddPromiseHook(&promise_hook_func, wrap);
  wrap->initialized_ = true;
}


void PromiseContext::Close(const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);

  PromiseContext* wrap;
  ASSIGN_OR_RETURN_UNWRAP(&wrap, args.Holder());
  if (wrap == nullptr || wrap->initialized_ == false)
    return;
  env->RemovePromiseHook(&promise_hook_func, wrap);
  ClearWrap(wrap->object());
  wrap->initialized_ = false;
  wrap->persistent().Reset();
  delete wrap;
}

#define SET_RETURN_ZERO args.GetReturnValue().Set(Integer::NewFromUnsigned(env->isolate(), 0))

void PromiseContext::GetCurrentPromiseId(const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);

  CHECK_EQ(args.Length(), 0);
  PromiseContext* wrap;
  ASSIGN_OR_RETURN_UNWRAP(&wrap, args.Holder());
  if (wrap == nullptr || wrap->initialized_ == false) {
    SET_RETURN_ZERO;
    return;
  }

  ActivePromise* promise = wrap->peek_promise();
  if (promise == nullptr) {
    SET_RETURN_ZERO;
  } else {
    args.GetReturnValue().Set(Integer::NewFromUnsigned(env->isolate(), promise->id()));
  }
}


void PromiseContext::GetParentPromiseId(const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);

  PromiseContext* wrap;
  ASSIGN_OR_RETURN_UNWRAP(&wrap, args.Holder());
  if (wrap == nullptr || wrap->initialized_ == false) {
    printf("[DEBUG] invalid wrapper\n");
    SET_RETURN_ZERO;
    return;
  }

  // Pick out which base promise we're searching for.  If the user passed
  // in an argument, then use it as a number.
  int32_t promise_id;
  if (args.Length() > 0 && !args[0]->IsUndefined() && !args[0]->IsNull()) {
    CHECK_EQ(args.Length(), 1);
    MaybeLocal<Uint32> number = args[0]->ToUint32(env->context());
    if (number.IsEmpty()) {
      printf("[WARN] could not cast argument to integer\n");
      SET_RETURN_ZERO;
      return;
    }
    promise_id = number.ToLocalChecked()->Value();
    printf("[DEBUG] using argument promise id %d\n", promise_id);
  } else {
    ActivePromise* promise = wrap->peek_promise();
    if (promise == nullptr) {
      printf("[WARN] no promise in stack\n");
      SET_RETURN_ZERO;
      return;
    }
    promise_id = promise->id();
  }
  printf("[DEBUG] finding parent for promise %d\n", promise_id);

  ActivePromise* promise = wrap->get_promise_for_id(promise_id);
  ActivePromise* parent = wrap->get_parent(promise);
  if (parent == nullptr) {
    printf("[DEBUG] no parent for promise %d\n", promise == nullptr ? 0 : promise->id());
    SET_RETURN_ZERO;
    return;
  }
  args.GetReturnValue().Set(Integer::NewFromUnsigned(env->isolate(), parent->id()));
}


void PromiseContext::promise_hook_func(PromiseHookType type,
                                       Local<Promise> promise,
                                       Local<Value> parent,
                                       void* arg) {
  PromiseContext *cc = (PromiseContext *)arg;
  switch (type) {
    case v8::PromiseHookType::kInit:
      // New promise was created.  If the new promise is part of a `.then` chain
      // or part of the intermediate promises of `all` or `race`, then the
      // `parent` argument has the parent promise.
      cc->add_active_promise(promise, parent);
      break;
    case v8::PromiseHookType::kResolve:
      // Start of the `resolve` or `reject` function.
      // Ignore
      break;
    case v8::PromiseHookType::kBefore:
      // Start of the job
      cc->push_promise(promise);
      break;
    case v8::PromiseHookType::kAfter:
      // At the end of the job
      cc->pop_promise(promise);
      cc->remove_active_promise(promise);
      break;
    default:
      // FAIL?
      break;
  }
}



PromiseContext::PromiseContext(Environment* env,
                               Local<Object> object)
    :
      BaseObject(env, object) {
  Wrap(object, this);
}


PromiseContext::~PromiseContext() {
  CHECK_EQ(initialized_, false);
  // FIXME
  // env_->RemovePromiseHook(&promise_hook_func, this);
}


void PromiseContext::add_active_promise(Local<Promise> promise,
                                        Local<Value> parent) {
  printf("[DEBUG] Added active promise\n");
  if (promise->IsUndefined()) {
    printf("[DEBUG] - promise is undefined?!?\n");
    return;
  }
  // DEBUG if/else block here is just for debugging.
  if (parent->IsUndefined() || parent->IsNull()) {
    printf("[DEBUG] - with null parent\n");
  } else {
    ActivePromise* active_parent = get_for_promise(Local<Promise>::Cast(parent));
    if (active_parent == nullptr) {
      printf("[DEBUG] - with unregistered parent promise\n");
    } else {
      printf("[DEBUG] - with parent id %d\n", active_parent->id());
    }
  }
  auto it = std::find_if(
      active_promises_.begin(), active_promises_.end(),
      [&](const ActivePromise* ac) {
        return ac->is_match(promise);
      });
  if (it != active_promises_.end()) {
    printf("[DEBUG] - promise added to existing id %d\n", (*it)->id());
    (*it)->add_match(parent);
    return;
  }
  active_promises_.push_back(new ActivePromise(env(), ++promise_count_, promise, parent));
  printf("[DEBUG] - promise assigned id %d\n", promise_count_);
}


bool PromiseContext::remove_active_promise(Local<Promise> promise) {
  printf("[DEBUG] Removing active promise\n");
  auto it = std::find_if(
      active_promises_.begin(), active_promises_.end(),
      [&](const ActivePromise* ac) {
        return ac->is_match(promise);
      });

  if (it == active_promises_.end()) return false;

  if ((*it)->remove_match()) {
    printf("[DEBUG] - removed %d\n", (*it)->id());
    delete *it;
    active_promises_.erase(it);
  } else {
    printf("[DEBUG] - decremented count for %d\n", (*it)->id());
  }
  return true;
}


void PromiseContext::push_promise(Local<Promise> promise) {
  printf("[DEBUG] pushed promise on stack\n");
  ActivePromise* active_promise = get_for_promise(promise);
  if (active_promise == nullptr) {
    printf("[DEBUG] - but promise is unregistered\n");
    return;
  }
  printf("[DEBUG] - promise %d\n", active_promise->id());
  promise_stack_.push_back(active_promise->id());
}


bool PromiseContext::pop_promise(Local<Promise> promise) {
  if (promise_stack_.size() <= 0) {
    printf("[DEBUG] tried to pop from an empty stack\n");
    return false;
  }
  ActivePromise* active_promise = get_for_promise(promise);
  if (active_promise == nullptr) {
    printf("[DEBUG] tried to pop with an unregistered promise\n");
    return false;
  }
  if (promise_stack_.back() != active_promise->id()) {
    // TODO need to check if it's valid to pop at a higher place.'
    printf("[DEBUG] tried to pop promise %d, but it wasn't at the end of the stack\n", active_promise->id());
    return false;
  }
  printf("[DEBUG] popped promise %d from stack\n", active_promise->id());
  promise_stack_.pop_back();
  return true;
}


ActivePromise* PromiseContext::peek_promise() {
  if (promise_stack_.size() <= 0) {
    printf("[DEBUG] peek: no promise on stack\n");
    return nullptr;
  }
  printf("[DEBUG] returning last promise (%d) from stack\n", promise_stack_.back());
  return get_promise_for_id(promise_stack_.back());
}


ActivePromise* PromiseContext::get_promise_for_id(const uint32_t promise_id) {
  auto it = std::find_if(
      active_promises_.begin(), active_promises_.end(),
      [&](const ActivePromise* ac) {
        return ac->id() == promise_id;
      });
  if (it == active_promises_.end()) {
    printf("[DEBUG] could not find registered promise %d\n", promise_id);
    return nullptr;
  }
  printf("[DEBUG] found promise with id %d\n", promise_id);
  return *it;
}


ActivePromise* PromiseContext::get_parent(const ActivePromise* active_promise) {
  if (active_promise == nullptr || !active_promise->has_parent()) {
    printf("[DEBUG] getting null parent promise\n");
    return nullptr;
  }
  return get_for_promise(active_promise->parent());
}


ActivePromise* PromiseContext::get_for_promise(const Local<Promise> promise) {
  // This initial check shouldn't be necessary.
  if (promise->IsUndefined() || promise->IsNull()) {
    printf("[DEBUG] getting null promise\n");
    return nullptr;
  }

  auto it = std::find_if(
      active_promises_.begin(), active_promises_.end(),
      [&](const ActivePromise* ac) {
        return ac->is_match(promise);
      });
  if (it == active_promises_.end()) {
    printf("[DEBUG] promise is not registered\n");
    return nullptr;
  }
  return *it;
}


ActivePromise::ActivePromise(Environment* env, uint32_t promise_id, const Local<Promise> promise, const Local<Value> parent)
  :
    promise_id_(promise_id),
    active_count_(1),
    isolate_(env->isolate()) {
  // promise must not be null.
  set_persistent_promise(env->isolate(), promise_, promise);
  set_persistent_value(env->isolate(), parent_, parent);
}

ActivePromise::~ActivePromise() {
  promise_.Reset();
  parent_.Reset();
}

void ActivePromise::add_match(Local<Value>& new_parent) {
  ++active_count_;
  if (new_parent->IsUndefined() || new_parent->IsNull()) {
    if (parent_.IsEmpty()) {
      printf("[WARN] request for promise %d but using undefined parent (ignored)\n", promise_id_);
    }
  } else {
    if (parent_.IsEmpty()) {
      printf("[WARN] request for promise %d replacing undefined parent with real parent promise\n", promise_id_);
    } else {
      printf("[WARN] request for promise %d replacing defined parent\n", promise_id_);
    }
    set_persistent_value(isolate_, parent_, new_parent);
  }
}

void ActivePromise::set_persistent_value(Isolate* isolate, Persistent<Promise>& persistent, const Local<Value>& local) {
  if (local->IsUndefined() || local->IsNull()) {
    persistent.Reset();
    return;
  }
  set_persistent_promise(isolate, persistent, Local<Promise>::Cast(local));
}

void ActivePromise::set_persistent_promise(Isolate* isolate, Persistent<Promise>& persistent, const Local<Promise>& local) {
  if (local->IsUndefined() || local->IsNull()) {
    persistent.Reset();
    return;
  }
  persistent.Reset(isolate, local);
}


}  // anonymous namespace
}  // namespace node


NODE_BUILTIN_MODULE_CONTEXT_AWARE(promise_context, node::PromiseContext::Initialize)
