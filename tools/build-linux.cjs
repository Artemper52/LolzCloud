'use strict';
process.env.LOLZCLOUD_BUILD_PLATFORM = 'linux';
process.env.LOLZCLOUD_BUILD_ARCH ||= ['x64', 'arm64'].includes(process.arch) ? process.arch : 'x64';
require('./build.cjs');
