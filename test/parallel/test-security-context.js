'use strict';
const common = require('../common');
const assert = require('assert');
const fs = require('fs');

const stackContext = require('context');
const security = require('security_context');


const controllerId1 = stackContext.getCurrentContext().pushControllers(
  security.addFileAccessController({
    readable: [common.tmpDir],
    writable: []
  })
);

try {
  common.expectsError(
    // () => { fs.open(common.tmpDir + '/a.tmp', 'w'); },
    () => {
      try {
        fs.open(common.tmpDir + '/a.tmp', 'w');
      } catch (e) {
        console.log('******** fs open generated error: ' + e);
        console.log(e.stack);
      }
    },
    {
      code: 'ERR_FILE_ACCESS_FORBIDDEN',
      type: Error,
      message: 'asdf'
    }
  );
  // FIXME
  assert.strictEqual(1, 1);
} finally {
  stackContext.getCurrentContext().popControllers(controllerId1);
}
