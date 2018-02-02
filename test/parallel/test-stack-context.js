'use strict';
const common = require('../common');
const assert = require('assert');

const stackContext = require('context');

function createRequiredController(data) {
  const d = {
    createChild: function(contextData) {
      return createRequiredController(contextData);
    },
    onContext: function(invoker) {
      if (!this._data.allow) {
        throw new Error('did not pass in allow (' + this._data.allow + ')');
      }
      invoker.invoke();
    }
  };
  d._data = data || {};
  return d;
}

// Popping the controller when there is no controller gets a special message
common.expectsError(
  () => { stackContext.getCurrentContext().popControllers('a'); },
  {
    code: 'ERR_INDEX_OUT_OF_RANGE',
    type: RangeError
  }
);

const controllerId1 = stackContext.getCurrentContext().pushControllers({
  required: createRequiredController({})
});
try {
  // Ensure that popping with the wrong id causes an error.
  common.expectsError(
    () => { stackContext.getCurrentContext().popControllers('a'); },
    {
      code: 'ERR_INVALID_ARG_VALUE',
      type: Error,
      message: 'The argument \'frameId\' is invalid. Received \'a\''
    }
  );

  // Ensure that a wrapped function is correctly invoked.
  let should_change = 0;
  stackContext.wrapFunction({ required: { allow: true } }, (a) => {
    should_change = a;
  })('this');
  assert.strictEqual(should_change, 'this');

  // Ensure that the context controller correctly fails.
  assert.throws(
    stackContext.wrapFunction(
      { required: { allow: false } },
      () => {}),
    Error,
    'did not pass in allow (false)'
  );
} finally {
  stackContext.getCurrentContext().popControllers(controllerId1);
}
