/**
 * Resolves the database the test suites are allowed to use.
 *
 * The suites call dropDatabase(), so pointing them at the wrong URI would
 * destroy real data. Now that the app's own MONGODB_URI is a shared Atlas
 * cluster, that is no longer a theoretical risk — so this refuses any
 * database whose name does not look like a test database, and always
 * replaces whatever database name an override carries with its own.
 *
 * Override the server with MONGODB_TEST_URI; the name rules still apply.
 */
const DEFAULT_TEST_SERVER = 'mongodb://127.0.0.1:27017'

export function resolveTestUri(databaseName) {
  if (!databaseName.includes('test')) {
    throw new Error(`Refusing to run tests against "${databaseName}": the name must contain "test".`)
  }

  const url = new URL(process.env.MONGODB_TEST_URI ?? DEFAULT_TEST_SERVER)
  url.pathname = `/${databaseName}`

  return url.toString()
}
