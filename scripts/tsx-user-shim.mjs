// tsx asks os.userInfo() for a temporary-directory suffix on Windows. Some
// locked-down Windows hosts return ENOMEM before test code starts. A process-
// local numeric identifier exercises tsx's existing Unix branch without
// changing the OS or dependency files. Other platforms keep their real uid.
if (process.platform === 'win32' && typeof process.geteuid !== 'function') {
  process.geteuid = () => 0;
}
