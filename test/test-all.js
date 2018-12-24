const { unlinkSync, writeFileSync, readFileSync, existsSync } = require('fs');
const { resolve: pathResolve, join: pathJoin } = require('path');
const assert = require('assert');
const spawn = require('npm-run-all/lib/spawn');;

const isWin = process.platform === 'win32';

/*
 * Paths used in tests (each of them are absolute)
 */
const testDir = pathResolve(__dirname);
const packageDir = pathJoin(testDir, '..');
// Arbitrary file which is created on watched file changes.
const changeFile = pathJoin(testDir, 'dir/change');


// Time to wait for different tasks
const TIMEOUT_WATCH_READY = 1000;
const TIMEOUT_CHANGE_DETECTED = 700;
const TIMEOUT_KILL = TIMEOUT_WATCH_READY + TIMEOUT_CHANGE_DETECTED + 1000;

// NOTE: is touch available on Windows?

describe('chokidar-cli', function () {

    describe('informational subcommands', function () {
        // Giving the informational subcommands a shorter timeout than the default since they should finish
        // relatively quickly (this cannot be done in a beforeEach hook because the timeout would apply to the hook).
        this.killTimeout = 1000;
        this.timeout(this.killTimeout + 200);

        it('help should be successful', function () {
            return run('node index.js --help', { cwd: packageDir, killTimeout: this.killTimeout });
        });

        it('version should be successful', function () {
            return run('node index.js -v', { cwd: packageDir, killTimeout: this.killTimeout });
        });
    });

    describe('subcommands that use the file system', function () {
        // Giving each test a timeout that is long enough to deal with processes being killed on timeout (this cannot
        // be done in a beforeEach hook because the timeout would apply to the hook).
        this.timeout(TIMEOUT_KILL * 2);

        it('**/*.less should detect all less files in dir tree', function (done) {
            // Use a file to detect that trigger command is actually run
            const touch = 'touch ' + changeFile;

            // No quotes needed in glob pattern because node process spawn does no globbing
            // TODO: touch command does not always create file before assertion
            expectKilledByTimeout(run('node ../index.js "dir/**/*.less" -c "' + touch + '"'))
                .then(done, done);

            setTimeout(function afterWatchIsReady() {
                writeFileSync(resolve('dir/subdir/c.less'), 'content');

                setTimeout(function() {
                    assert(changeFileExists(), 'change file should exist');
                }, TIMEOUT_CHANGE_DETECTED);
            }, TIMEOUT_WATCH_READY);
        });

        it('should throttle invocations of command', function (done) {
            // when two writes to a watched file happen within the throttleTime period, only the first one triggers
            // running the command
            const touch = 'touch ' + changeFile;
            const changedDetectedTime = 100;
            const throttleTime = (2 * changedDetectedTime) + 100;

            expectKilledByTimeout(
                run('node ../index.js "dir/**/*.less" --debounce 0 --throttle ' + throttleTime + ' -c "' + touch + '"')
            )
                .then(done, done);

            setTimeout(function afterWatchIsReady() {
                writeFileSync(resolve('dir/subdir/c.less'), 'content');
                setTimeout(function() {
                    assert(changeFileExists(), 'change file should exist after first change');
                    deleteChangeFileSync();
                    writeFileSync(resolve('dir/subdir/c.less'), 'more content');
                    setTimeout(function() {
                        assert.equal(changeFileExists(), false, 'change file should not exist after second change');
                    }, changedDetectedTime);
                }, changedDetectedTime);
            }, TIMEOUT_WATCH_READY);
        });

        it('should debounce invocations of command', function (done) {
            // when two writes to a watched file happen within the debounceTime period, the command should be run
            // after the debounce time has elapsed (and not before it has elapsed).
            const touch = 'touch ' + changeFile;
            const changedDetectedTime = 100;
            const debounceTime = (2 * changedDetectedTime) + 100;
            const killTime = TIMEOUT_WATCH_READY + (2 * changedDetectedTime) + debounceTime + 1000;

            expectKilledByTimeout(
                run('node ../index.js "dir/**/*.less" --debounce ' + debounceTime + ' -c "' + touch + '"', {
                    killTimeout: killTime,
                })
            )
                .then(() => {
                    // process terminated normally, which is not what is expected in this test;
                    done(new Error('process terminated too soon'));
                })
                .catch((error) => {
                    // we expect the process to be killed by a timeout
                    if (error.reason && error.reason === REASON_TIMEOUT) {
                        return done();
                    }
                    // if not, then this was some other error
                    done(error);
                });

            setTimeout(function afterWatchIsReady() {
                writeFileSync(resolve('dir/subdir/c.less'), 'content');
                setTimeout(function() {
                    assert.equal(changeFileExists(), false, 'change file should not exist earlier than debounce time (first)');
                    writeFileSync(resolve('dir/subdir/c.less'), 'more content');
                    setTimeout(function() {
                        assert.equal(changeFileExists(), false, 'change file should not exist earlier than debounce time (second)');
                    }, changedDetectedTime);
                    setTimeout(function() {
                        assert(changeFileExists(), 'change file should exist after debounce time');
                    }, debounceTime + changedDetectedTime);
                }, changedDetectedTime);
            }, TIMEOUT_WATCH_READY);

        });

        it('should replace {path} and {event} in command', function (done) {
            const command = "echo '{event}:{path}' > " + changeFile;

            setTimeout(function() {
                // trigger a change event
                writeFileSync(resolve('dir/a.js'), 'content');
            }, TIMEOUT_WATCH_READY);

            expectKilledByTimeout(run('node ../index.js "dir/a.js" -c "' + command + '"'))
                .then(() => {
                    var res = readFileSync(changeFile).toString().trim();
                    assert.equal(res, 'change:dir/a.js', 'need event/path detail');
                    done();
                })
                .catch(done);
        });

        afterEach(function () {
            deleteChangeFileSync()
            // NOTE: it seems like this doesn't always get run at the end of a test, because we're sometimes left with
            // a dirty working copy (test/dir/a.js has content in it when it should be blank)
            // TODO: should we depend on every system this runs in to have git?
            return run('git checkout HEAD dir');
        });
    });
});

/*
 * Test Helpers
 */

// TODO: we could get rid of this helper if we just resolve the paths to files we care about once before the test runs
// instead of dynamically during the test
function resolve(relativePath) {
    return pathJoin(testDir, relativePath);
}

/**
 * Cleans up the change file by making sure its removed.
 */
function deleteChangeFileSync() {
    try {
        unlinkSync(changeFile);
    } catch (error) {
        // if the file doesn't exist, then its fine to swallow the ENOENT error, otherwise throw
        if (error.code !== 'ENOENT') {
            throw error;
        }
    }
}

function changeFileExists() {
    return existsSync(changeFile);
}


/** Flag for when a process is killed by the following helper */
const REASON_TIMEOUT = Symbol('REASON_TIMEOUT');

/**
 * Run a command. Returns a promise that resolves or rejects when the process finishes. The promise resolves when the
 * process finishes normally, and rejects when the process finishes abnormally (like being killed after a timeout).
 * @param {string} cmd - the command to run
 * @param {string} options.cwd - the current working directory for the command, defaults to testDir
 * @param {boolean} options.shouldInheritStdio - when set to true, the stdio will be piped to this processes stdio
 * which is useful for debugging but may cause zombie processes to stick around, defaults to false.
 * @param {number} options.killTimeout - number of milliseconds to wait for the command to exit before killing it and
 * its children processes, defaults to TIMEOUT_KILL.
 * @returns {Promise}
 */
function run(cmd, { cwd = testDir, shouldInheritStdio = false, killTimeout = TIMEOUT_KILL } = {}) {
    let child;
    try {
        child = spawn(cmd, {
            cwd,
            stdio: shouldInheritStdio ? 'inherit' : null,
            // the cross-spawn package in the implementation of this call will give us some nice behavior in Windows
            // with this option turned on, however it turns off nice behavior in *nix platforms, so we conditionally
            // set it here.
            // shell: isWin,
            shell: true,
        });
    } catch (error) {
        return Promise.reject(error);
    }

    return new Promise((resolve, reject) => {
        function e(error) { child.off('close', c); reject(error); }
        function c(exitCode, signal) {
            child.off('error', e);
            if (exitCode === 0 && !signal) {
                return resolve();
            }
            const error = new Error('child process terminated abnormally');
            error.reason = child._killedFromTimeout ? REASON_TIMEOUT : (exitCode === null ? signal : exitCode);
            reject(error);
        }
        child.once('error', e);
        // within the child process lifecycle, the close event happens *after* the exit event and also gets the
        // exit code of the process.
        // TODO: figure out if inherited (or not) stdio streams make the previous statement untrue.
        child.once('close', c);

        setTimeout(() => {
            child._killedFromTimeout = true;
            child.kill();
        }, killTimeout);
    });
}

/**
 * Enforces that the input promise, which comes from the output of run() above, rejects because of a timeout and for
 * no other reason.
 * @param {Promise} runPromise - input promise
 * @returns {Promise} a promise that resolves when the input promise rejected because of a timeout, rejects otherwise
 */
function expectKilledByTimeout(runPromise) {
    return runPromise.then(
        () => {
            // process terminated normally, which is not what is expected in this test;
            throw new Error('process terminated too soon');
        },
        (error) => {
            // only swallow the error if the reason was a timeout
            if (!error.reason || error.reason !== REASON_TIMEOUT) {
                throw error;
            }
        }
    );
}
