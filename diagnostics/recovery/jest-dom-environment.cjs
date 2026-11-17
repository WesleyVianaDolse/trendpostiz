// These DOM tests do not use canvas. The Windows installation contains the
// optional canvas JS package without its native binary; model its absence only
// while jsdom discovers optional dependencies. Production code is untouched.
const Module=require('node:module');
const {TestEnvironment}=require('jest-environment-jsdom');
module.exports=class RecoveryDomEnvironment extends TestEnvironment {
  constructor(config,context){
    const resolve=Module._resolveFilename;
    Module._resolveFilename=function(name,...args){if(name==='canvas'){const e=Error('Optional canvas unavailable');e.code='MODULE_NOT_FOUND';throw e;}return resolve.call(this,name,...args);};
    try{super(config,context);}finally{Module._resolveFilename=resolve;}
  }
};
