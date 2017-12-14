'use strict';

const { PromiseContext } = process.binding('promise_context');

const promiseContext = new PromiseContext();
promiseContext.start();

const getCurrentPromiseId = () => {
  return promiseContext.getCurrentPromiseId();
};

const getParentPromiseId = (promise) => {
  return promiseContext.getParentPromiseId(promise);
};

const getContextPromiseId = () => {
  let head = getCurrentPromiseId();
  let last = head;
  while (head > 0) {
    last = head;
    head = getParentPromiseId(head);
  }
  return last;
};

module.exports = exports = {
  getCurrentPromiseId,
  getParentPromiseId,
  getContextPromiseId
};
