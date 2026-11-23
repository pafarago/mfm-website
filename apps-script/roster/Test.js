function requestAllPermissions() {
  ScriptApp.requireAllScopes(ScriptApp.AuthMode.FULL);
}
function showPins() {
  CacheService.getScriptCache().remove('pins');
  var p = readPins_();
  Logger.log(Object.keys(p).length + ' people: ' + Object.keys(p).join(', '));
}
/** Run from the editor: ends a password lockout for one address. */
function clearLockout() {
  var email = 'admin@midlothianfriends.org';   // the locked address
  var cache = CacheService.getScriptCache();
  cache.remove('lock_' + email);
  cache.remove('fail_' + email);
  Logger.log('Lockout cleared for ' + email);
}