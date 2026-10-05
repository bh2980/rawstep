/**
 * Conventional Commits, following bh2980_blog: `type(scope): 한국어 서술`.
 * Scope is optional; when given it names the workspace package (or deps/repo for workspace-wide changes).
 */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [2, 'always', ['core', 'policies', 'browser', 'screenreaders', 'reports', 'cli', 'dashboard', 'rawstep', 'deps', 'repo']],
    // Korean subjects have no letter case.
    'subject-case': [0],
    'header-max-length': [2, 'always', 100],
    // Bodies carry long Korean sentences and trailers such as Co-Authored-By.
    'body-max-line-length': [0],
    'footer-max-line-length': [0],
  },
};
