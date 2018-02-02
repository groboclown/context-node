'use strict';
const common = require('../common');
//const assert = require('assert');
const fs = require('fs');

const stackContext = require('context');
const security = require('security_context');


function fsSecurityTest(name, setup, fn) {
  const controllerId = stackContext.getCurrentContext().pushControllers(
    security.addFileAccessController(setup)
  );
  try {
    fn();
  } catch (e) {
    console.log('Failed `' + name + '`: ' + e);
    console.log(e.stack);
    throw e;
  } finally {
    stackContext.getCurrentContext().popControllers(controllerId);
  }
}


fsSecurityTest(
  'fs.access: allowed',
  { listable: [ common.tmpDir ] },
  () => {
    fs.access(common.tmpDir, 0, (err, a) => {});
  }
);


fsSecurityTest(
  'file access control wrapper check - readable as object',
  {},
  () => {
    common.expectsError(
      () => {
        stackContext.getCurrentContext().pushControllers(
          security.addFileAccessController({ readable: {} }));
      },
      {
        code: 'ERR_INVALID_ARG_TYPE',
        type: TypeError,
        message: 'The "readable" argument must be of type string | ' +
          'RegExp | array of string or RegExp. Received type object'
      }
    );
  }
);

fsSecurityTest(
  'file access control wrapper check - array of object', {},
  () => {
    common.expectsError(
      () => {
        stackContext.getCurrentContext().pushControllers(
          security.addFileAccessController({ readable: [{}] }));
      },
      {
        code: 'ERR_INVALID_ARG_TYPE',
        type: TypeError,
        message: 'The "readable" argument must be one of type string, ' +
          'RegExp, or array of string or RegExp. Received type object'
      }
    );
  }
);

fsSecurityTest(
  'fs.open for read: allowed (dir matcher)',
  { readable: common.tmpDir + '/' },
  () => {
    fs.open(common.tmpDir + '/a.tmp', 'r', (err, a) => {});
  }
);

fsSecurityTest(
  'fs.open for read: allowed (exact string matcher)',
  { readable: common.tmpDir + '/a.tmp' },
  () => {
    fs.open(common.tmpDir + '/a.tmp', 'r', (err, a) => {});
  }
);

fsSecurityTest(
  'fs.open for read: allowed (simple glob matcher)',
  { readable: common.tmpDir + '/*.tmp' },
  () => {
    fs.open(common.tmpDir + '/a.tmp', 'r', (err, a) => {});
    fs.open(common.tmpDir + '/b.tmp', 'r', (err, a) => {});
  }
);

fsSecurityTest(
  'fs.open for read: allowed (sub dir glob matcher)',
  { readable: common.tmpDir + '/*/a.tmp' },
  () => {
    fs.open(common.tmpDir + '/x/a.tmp', 'r', (err, a) => {});
    fs.open(common.tmpDir + '/y/a.tmp', 'r', (err, a) => {});
  }
);

fsSecurityTest(
  'fs.open for write: allowed',
  { writable: common.tmpDir + '/' },
  () => {
    fs.open(common.tmpDir + '/a.tmp', 'w', (err, a) => {});
  }
);

fsSecurityTest(
  'fs.open for read: not allowed (no paths allowed)',
  { readable: [] },
  () => {
    common.expectsError(
      () => {
        fs.open(common.tmpDir + '/a.tmp', 'r', (err, a) => {});
      },
      {
        code: 'ERR_FILE_ACCESS_FORBIDDEN',
        type: Error,
        message: new RegExp(
          'Access to the file ".*?" is forbidden by the current ' +
          'security context')
      });
  }
);

fsSecurityTest(
  'fs.open for read: not allowed (leading path not a dir matcher)',
  { readable: common.tmpDir },
  () => {
    common.expectsError(
      () => {
        fs.open(common.tmpDir + '/a.tmp', 'r', (err, a) => {});
      },
      {
        code: 'ERR_FILE_ACCESS_FORBIDDEN',
        type: Error,
        message: new RegExp(
          'Access to the file ".*" is forbidden by the current security ' +
          'context')
      });
  }
);

fsSecurityTest(
  'fs.open for read: not allowed (string matcher)',
  { readable: common.tmpDir + '/b.tmp' },
  () => {
    common.expectsError(
      () => {
        fs.open(common.tmpDir + '/a.tmp', 'r', (err, a) => {});
      },
      {
        code: 'ERR_FILE_ACCESS_FORBIDDEN',
        type: Error,
        message: new RegExp(
          'Access to the file ".*" is forbidden by the current security ' +
          'context')
      });
  }
);

fsSecurityTest(
  'fs.open for read: not allowed (simple glob matcher)',
  { readable: common.tmpDir + '/*.tmp' },
  () => {
    common.expectsError(
      () => {
        fs.open(common.tmpDir + '/a.abc', 'r', (err, a) => {});
      },
      {
        code: 'ERR_FILE_ACCESS_FORBIDDEN',
        type: Error,
        message: new RegExp(
          'Access to the file ".*" is forbidden by the current security ' +
          'context')
      });
  }
);

fsSecurityTest(
  'fs.open for write: not allowed',
  { writable: [] },
  () => {
    common.expectsError(
      () => {
        fs.open(common.tmpDir + '/a.tmp', 'w', (err, a) => {});
      },
      {
        code: 'ERR_FILE_ACCESS_FORBIDDEN',
        type: Error,
        message: new RegExp(
          'Access to the file ".*" is forbidden by the current security ' +
          'context')
      });
  }
);
