'use strict';

const util = require('util');

const promise_context = require('promise_context');

let errors;
function lazyErrors() {
  if (errors === undefined) {
    errors = require('internal/errors');
  }
  return errors;
}


/**
 * Wrapper for invoking the underlying function from the context controller.
 */
class ContextInvocation {
  constructor(
    scopedThis, // Object | undefined
    invoked, // Function
    args, // any[]
    argDescriptors, // IArguments | undefined
    target, // Object | undefined
    propertyKey // string | symbol | undefined
  ) {
    Object.defineProperties(this, {
      scopedThis: {
        enumerable: true,
        writable: false,
        value: scopedThis
      },
      invoked: {
        enumerable: true,
        writable: false,
        value: invoked
      },
      args: {
        enumerable: true,
        writable: false,
        value: args
      },
      argDescriptors: {
        enumerable: true,
        writable: false,
        value: argDescriptors
      },
      target: {
        enumerable: true,
        writable: false,
        value: target
      },
      propertyKey: {
        enumerable: true,
        writable: false,
        value: propertyKey
      }
    });
  }

  /**
   * Invoke the target method, and return its return value. This can also
   * throw any Error.
   */
  invoke() {
    const errors = lazyErrors();
    throw new errors.TypeError('ERR_METHOD_NOT_IMPLEMENTED', 'invoke');
  }
}


/**
 * Tests if a value matches the criteria for being a Segment Contextual
 * Controller.
 */
const isSegmentContextualController = (value) => {
  if (typeof value !== 'object') {
    return false;
  }
  if (typeof value.createChild !== 'function') {
    return false;
  }
  if (typeof value.onContext !== 'function') {
    return false;
  }
  return true;
};


const kSegmentsStack = Symbol('_segmentsStack');
const kFrameId = Symbol('_frame_id');

const _FRAME_CHARS =
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const _create_frame_id = () => {
  let ret = '';
  for (var i = 0; i < 32; i++) {
    ret += _FRAME_CHARS[Math.floor(Math.random() * _FRAME_CHARS.length)];
  }
  return ret;
};


/**
 * Stack of the segmented context controllers.
 */
class ContextControllerStack {
  constructor() {
    Object.defineProperties(this, {
      [kSegmentsStack]: {
        enumerable: false,
        writable: false,
        value: []
      }
    });
  }

  /**
   * Flatten all the current controllers into a single frame, which uses the
   * given frameId.  Returns a new ContextControllerStack.
   */
  fork(frameId) {
    if (!frameId) {
      const errors = lazyErrors();
      throw new errors.Error('ERR_INVALID_ARG_VALUE', 'frameId', frameId);
    }
    const ret = new ContextControllerStack();
    // Loop in order through the stack, so that the last one wins.
    // Additionally, the kFrameId will be overwritten.
    const newSegs = {};
    for (var i = 0; i < this[kSegmentsStack].length; i++) {
      const src = this[kSegmentsStack][i];
      for (var k in src) {
        newSegs[k] = src[k];
      }
    }
    newSegs[kFrameId] = frameId;
    ret[kSegmentsStack].push(newSegs);
    return ret;
  }

  /**
   * Called when a new context is entered, which requires a
   * change in the existing stack.
   *
   * @param segmentControllers an object where each key is the segment name,
   *    and the value is the controller.
   */
  push(segmentControllers) {
    const frameId = _create_frame_id();
    const newSegs = {};
    for (var kind in segmentControllers) {
      if (segmentControllers.hasOwnProperty(kind)) {
        const controller = segmentControllers[kind];
        if (!isSegmentContextualController(controller)) {
          const errors = lazyErrors();
          throw new errors.TypeError('ERR_INVALID_ARG_TYPE',
                                     'segmentControllers',
                                     'SegmentContextualController',
                                     controller);
        }
        newSegs[kind] = controller;
      }
    }
    newSegs[kFrameId] = frameId;
    this[kSegmentsStack].push(newSegs);
    return frameId;
  }

  pop(frameId) {
    if (this.isEmpty) {
      const errors = lazyErrors();
      throw new errors.RangeError('ERR_INDEX_OUT_OF_RANGE');
    }
    const last = this[kSegmentsStack][this[kSegmentsStack].length - 1];
    if (last[kFrameId] !== frameId) {
      const errors = lazyErrors();
      throw new errors.Error('ERR_INVALID_ARG_VALUE', 'frameId', frameId);
    }
    this[kSegmentsStack].pop();
  }

  getSegmentController(segmentId) {
    // loop through our stack backwards
    let i = this[kSegmentsStack].length;
    while (--i >= 0) {
      if (this[kSegmentsStack][i][segmentId]) {
        return this[kSegmentsStack][i][segmentId];
      }
    }
    // not found
    return null;
  }

  get isEmpty() {
    return this[kSegmentsStack].length <= 0;
  }

}


/**
 * Simple, low-level invoking of the requested method.  Used at the
 * lowest level of the context invocation chain.
 */
class InnerContextInvocation extends ContextInvocation {
  invoke() {
    return this.invoked.apply(this.scopedThis, this.args);
  }
}


/**
 * Runs another context invocation, creating a composite function.
 */
class CompositeContextInvocation extends ContextInvocation {
  constructor(
    scopedThis, // Object | undefined,
    invoked, // Function,
    args, // any[],
    argDescriptors, // IArguments | undefined,
    target, // Object | undefined,
    propertyKey, // string | symbol | undefined,
    innerInvoke, // ContextInvocation<T>,
    innerContext // RunContext<any>
  ) {
    super(scopedThis, invoked, args, argDescriptors, target, propertyKey);
    this.innerInvoke = innerInvoke;
    this.innerContext = innerContext;
  }

  invoke() {
    return this.innerContext.onContext(this.innerInvoke);
  }
}


const kStack = Symbol('_stack');
const kStrictControllers = Symbol('_strict_controllers');
const kStrictSegments = Symbol('_strict_segments');


/**
 * Implementation of the context view.  This builds up the invoker chain
 * so that the correct context wrapping can work.
 */
class ExecutionContextViewImpl {
  constructor(stack, strictControllers, strictSegments) {
    if (stack === null || stack === undefined ||
        !(stack instanceof ContextControllerStack)) {
      const errors = lazyErrors();
      throw new errors.TypeError(
        'ERR_INVALID_ARG_TYPE', 'stack', 'ContextControllerStack', stack);
    }

    Object.defineProperties(this, {
      [kStack]: {
        enumerable: false,
        writable: false,
        value: stack
      },
      [kStrictControllers]: {
        enumerable: false,
        writable: false,
        value: !!strictControllers
      },
      [kStrictSegments]: {
        enumerable: false,
        writable: false,
        value: !!strictSegments
      }
    });
  }

  /**
   * When strict controllers is enabled, then the call to push controllers with
   * an already registered controller segment will cause an error.  When this
   * is false, then they will be silently ignored.
   */
  get isStrictControllers() {
    return this[kStrictControllers];
  }

  /**
   * When strict segments is enabled, then the call the run in a context will
   * cause an error if the segment context does not have a corresponding
   * controller.  When this is false, then such contexts will be ignored.
   */
  get isStrictSegments() {
    return this[kStrictSegments];
  }

  /**
   * Adds new controllers to the stack, and returns the ID used for
   * popping the controllers.
   */
  pushControllers(controllers) {
    if (this.isStrictControllers) {
      for (var k in controllers) {
        if (controllers.hasOwnProperty(k) &&
            this[kStack].getSegmentController(k)) {
          const errors = lazyErrors();
          throw new errors.Error('ERR_INVALID_OPT_VALUE',
                                 'controllerMap.' + k,
                                 '(already set, and in strict mode)');
        }
      }
    }
    return this[kStack].push(controllers);
  }

  popControllers(controllerId) {
    this[kStack].pop(controllerId);
  }

  /**
   * returns a view on the new stack.
   *
   * The `isStrictControllers` and `isStrictSegments` only matter if they are
   * explicitly `true`.  Any other value is ignored, and instead the current
   * value is used.
   */
  fork(isStrictControllers, isStrictSegments) {
    const newFrameId = _create_frame_id();
    const newView = new ExecutionContextViewImpl(
      this[kStack].fork(newFrameId),
      this.isStrictControllers || !!isStrictControllers,
      this.isStrictSegments || !!isStrictSegments
    );
    return newView;
  }

  runInContext(
    segmentOptions, // SegmentedContextOptions,
    scopedThis, // Object | undefined,
    invoked, // Function,
    args, // any[],
    argDescriptors, // IArguments | undefined,
    target, // any | undefined,
    propertyKey // string | symbol | undefined
  ) {
    // First, create the new controllers for the passed-in contexts.
    const controllers = {};

    // Create the lowest level of our invocation chain, which actually invokes
    // the requested method.  We do this now, because we're going to only
    // run context controller execution for the controllers that were directly
    // referenced by the function invocation.
    let invoker = new InnerContextInvocation(
      scopedThis, invoked, args, argDescriptors, target, propertyKey
    );

    for (var k in segmentOptions) {
      if (segmentOptions.hasOwnProperty(k)) {
        const controller = this[kStack].getSegmentController(k);
        if (controller) {
          const child = controller.createChild(segmentOptions[k]);
          if (!isSegmentContextualController(child)) {
            const errors = lazyErrors();
            throw new errors.TypeError('ERR_INVALID_ARG_TYPE',
                                       'createChild for segment ' + k,
                                       'SegmentContextualController',
                                       controller);
          }
          controllers[k] = child;
          invoker = new CompositeContextInvocation(
            scopedThis, invoked, args, argDescriptors, target, propertyKey,
            invoker, child
          );
        } else if (this.isStrictSegments) {
          const errors = lazyErrors();
          throw new errors.TypeError('ERR_INVALID_ARG_VALUE',
                                     'requested unregistered segment ' + k,
                                     'SegmentContextualController',
                                     controller);
        }
      }
    }

    // mark that the new context was entered.
    const frameId = this[kStack].push(controllers);

    try {
      //console.log(`[DEBUG ${this._threadName}]: starting invocation`);
      return invoker.invoke();
    } finally {
      this[kStack].pop(frameId);
    }
  }
}


const isExecutionContextView = (obj) => {
  if (!util.isObject(obj)) {
    return false;
  }
  if (!util.isFunction(obj.runInContext)) {
    return false;
  }
  if (!util.isFunction(obj.pushControllers)) {
    return false;
  }
  if (obj.isStrictControllers !== true && obj.isStrictControllers !== false) {
    return false;
  }
  if (obj.isStrictSegments !== true && obj.isStrictSegments !== false) {
    return false;
  }
  return true;
};


const _getCurrentThreadId = () => {
  return '#' + promise_context.getCurrentPromiseId();
};

const DEFAULT_THREAD_NAME = _getCurrentThreadId();
const _threadNameToView = {};
const _threadIdToName = {};
_threadIdToName[DEFAULT_THREAD_NAME] = _create_frame_id();
_threadNameToView[_threadIdToName[DEFAULT_THREAD_NAME]] =
  new ExecutionContextViewImpl(new ContextControllerStack(), false, false);


const _getContextId = () => {
  let threadId = promise_context.getCurrentPromiseId();
  while (!_threadIdToName['#' + threadId]) {
    const nextId = promise_context.getParentPromiseId(threadId);
    if (nextId === threadId || nextId === undefined || nextId === null) {
      return DEFAULT_THREAD_NAME;
    }
    threadId = nextId;
  }
  return '#' + threadId;
};


const getContextName = () => {
  return _threadIdToName[_getContextId()];
};


const getCurrentContext = () => {
  return _threadNameToView[getContextName()];
};


const forkForPromise = (isStrictControllers, isStrictSegments) => {
  const currentView = getCurrentContext();
  const newName = _create_frame_id();
  _threadNameToView[newName] = currentView.fork(isStrictControllers,
                                                isStrictSegments);
  return newName;
};


/**
 * Called at the start of a new promise, using the context name returned by
 * a call to `forkForPromise`.  The general approach to using promises
 * is:
 *
 * ```javascript
 * const context = require('context');
 * let promiseId = context.forkForPromise();
 * new Promise((resolve, reject) => {
 *      context.startPromise(promiseId);
 *      resolve(null);
 *     })
 *    .then(() -> { ... })
 *    ...
 *    .finally(() => { context.endPromise(promiseId); })
 * ```
 * Right now, the finally statement is only enabled if you have the
 * `--harmony-promise-finally` flag turned on.
 */
const startPromise = (contextName) => {
  if (!_threadNameToView[contextName]) {
    const errors = lazyErrors();
    throw new errors.Error('ERR_INVALID_OPT_VALUE', 'contextName',
                           'forkForPromise never returned value');
  }
  const currentThreadId = _getCurrentThreadId();
  if (_threadIdToName[currentThreadId]) {
    const errors = lazyErrors();
    throw new errors.Error('ERR_INVALID_OPT_VALUE', 'contextName',
                           'promise context already started');
  }
  _threadIdToName[currentThreadId] = contextName;
};


const endPromise = (contextName) => {
  for (var k in _threadIdToName) {
    if (_threadIdToName.hasOwnProperty(k) &&
        _threadIdToName[k] === contextName) {
      delete _threadIdToName[k];
      delete _threadNameToView[contextName];
      return true;
    }
  }
  // fail silently
  return false;
};


/**
 * Helper to run a promise within a forked context.
 */
const wrapPromise = (promise, isStrictControllers, isStrictSegments) => {
  if (typeof promise !== 'object' || typeof promise.then !== 'function') {
    const errors = lazyErrors();
    throw new errors.TypeError(
      'ERR_INVALID_ARG_VALUE', 'promise', 'Promise', promise);
  }
  const contextName = forkForPromise(isStrictControllers, isStrictSegments);
  if (typeof promise.finally === 'function') {
    // Use the 'finally' function, part of TC39 ECMAScript proposal.
    return Promise.resolve(() => {
      startPromise(contextName);
      return promise;
    }).finally(() => {
      endPromise(contextName);
    });
  }

  // Old style handler.  This works by first returning (thus resolving)
  // the passed-in promise, and when that completes, run our endPromise,
  // which then returns the now-completed passed-in promise results.
  const fin = () => Promise.resolve(
    () => { endPromise(); }
  ).then(() => promise);
  return new Promise((resolve, reject) => {
    startPromise(contextName);
    resolve(promise);
  }).then(fin, fin);
};


/**
 * Wrap a function definition inside a run context exeution.  This will return
 * a new function that can be used in place of the passed-in function.
 */
const wrapFunction = (segmentOptions, func) => {
  return function() {
    const view = getCurrentContext();
    return view.runInContext(
      segmentOptions, // SegmentedContextOptions,
      this, // Object | undefined,
      func, // Function,
      arguments, // any[],
      undefined, // IArguments | undefined,
      this, // any | undefined,
      undefined // string | symbol | undefined
    );
  };
};


module.exports = exports = {
  ContextInvocation,
  isExecutionContextView,
  getCurrentContext,
  wrapFunction,
  startPromise,
  endPromise,
  forkForPromise,
  wrapPromise
};
