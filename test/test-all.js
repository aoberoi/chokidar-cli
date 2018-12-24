const { unlinkSync, writeFileSync, readFileSync, existsSync } = require('fs');
const { resolve: pathResolve, join: pathJoin } = require('path');
const assert = require('assert');
const spawn = require('npm-run-all/lib/spawn');;

/*
 * Paths used in tests (each of them are absolute)
 */
const testDir = pathResolve(__dirname);
const packageDir = pathJoin(testDir, '..');
// File which is created on watched file changes, whose existence is used to verify if commands are run.
const changeFile = pathJoin(testDir, 'dir/change');
const lessFile = pathJoin(testDir, 'dir/subdir/c.less');
const jsFile = pathJoin(testDir, 'dir/a.js');


/*
 * Timeouts used throughout the tests (each of them in milliseconds)
 */
const TIMEOUT_WATCH_READY = 1000;
const TIMEOUT_CHANGE_DETECTED = 700;
const TIMEOUT_PADDING = 300;

const isWin = process.platform === 'win32';
const touchCmd = isWin ? 'copy NUL ' : 'touch ';

describe('chokidar-cli', function () {

    describe('informational subcommands', function () {
        // Giving the informational subcommands a shorter timeout than the default since they should finish
        // relatively quickly (this cannot be done in a beforeEach hook because the timeout would apply to the hook).
        const timeToRun = 1000;
        this.timeout(timeToRun + TIMEOUT_PADDING);

        it('help should be successful', function () {
            return run('node index.js --help', timeToRun, { shouldInheritStdio: true });
        });

        it('version should be successful', function () {
            return run('node index.js -v', timeToRun, { shouldInheritStdio: true });
        });
    });

    // TODO: When a failure happens by an assert throwing (not calling done), the child process will outlive the test
    // case, and potentially cause havoc in future test cases. Asserting inside setTimeout()s are probably a bad idea.
    describe('subcommands that use the file system', function () {
        it('**/*.less should detect all less files in dir tree', function (done) {
            const timeToRun = TIMEOUT_WATCH_READY + TIMEOUT_CHANGE_DETECTED + 100;
            this.timeout(timeToRun + TIMEOUT_PADDING);

            // Use a file to detect that trigger command is actually run
            // TODO: could move this to the outermost scope
            const touch = touchCmd + changeFile;

            // No quotes needed in glob pattern because node process spawn does no globbing
            // expectKilledByTimeout(run('node index.js "test/dir/**/*.less" -c "' + touch + '"', timeToRun))
            //     .then(done, done);
            // TODO: use template literals
            run(`node index.js "test/dir/**/*.less" -c "` + touch + '"', timeToRun, { shouldInheritStdio: true })
                .catch((error) => {
                    if (error.code === 'ENOENT') {
                        return done();
                    }

                    // TODO: let's get something to output here on windows
                    // only swallow the error if the reason was a timeout
                    if (!error.reason || error.reason !== REASON_TIMEOUT) {
                        return done(error);
                    }
                    done();
                });

            setTimeout(function afterWatchIsReady() {
                writeFileSync(lessFile, 'content');

                setTimeout(function() {
                    assert(existsSync(changeFile), 'change file should exist');
                }, TIMEOUT_CHANGE_DETECTED);
            }, TIMEOUT_WATCH_READY);
        });

        it.skip('should throttle invocations of command', function (done) {
            // when two writes to a watched file happen within the throttleTime period, only the first one triggers
            // running the command

            const timeToRun = TIMEOUT_WATCH_READY + (2 * TIMEOUT_CHANGE_DETECTED) + 100;
            this.timeout(timeToRun + TIMEOUT_PADDING);

            const touch = touchCmd + changeFile;
            const throttleTime = (2 * TIMEOUT_CHANGE_DETECTED) + 100;

            expectKilledByTimeout(run(
                'node index.js "test/dir/**/*.less" --debounce 0 --throttle ' + throttleTime + ' -c "' + touch + '"',
                timeToRun,
            ))
                .then(done, done);

            setTimeout(function afterWatchIsReady() {
                writeFileSync(lessFile, 'content');
                setTimeout(function() {
                    assert(existsSync(changeFile), 'change file should exist after first change');
                    deleteChangeFileSync();
                    writeFileSync(lessFile, 'more content');
                    setTimeout(function() {
                        assert.equal(existsSync(changeFile), false, 'change file should not exist after second change');
                    }, TIMEOUT_CHANGE_DETECTED);
                }, TIMEOUT_CHANGE_DETECTED);
            }, TIMEOUT_WATCH_READY);
        });

        it.skip('should debounce invocations of command', function (done) {
            // when two writes to a watched file happen within the debounceTime period, the command should be run
            // after the debounce time has elapsed (and not before it has elapsed).

            const debouncePadding = 1000;
            const debounceTime = (2 * TIMEOUT_CHANGE_DETECTED);
            const timeToRun = TIMEOUT_WATCH_READY + debounceTime + debouncePadding + 100;
            this.timeout(timeToRun + TIMEOUT_PADDING);

            const touch = touchCmd + changeFile;

            expectKilledByTimeout(
                run('node index.js "test/dir/**/*.less" --debounce ' + debounceTime + ' -c "' + touch + '"', timeToRun)
            )
                .then(done, done);

            setTimeout(function afterWatchIsReady() {
                writeFileSync(lessFile, 'content');
                setTimeout(function() {
                    assert.equal(existsSync(changeFile), false, 'change file should not exist earlier than debounce time (first)');
                    writeFileSync(lessFile, 'more content');
                    setTimeout(function() {
                        assert.equal(existsSync(changeFile), false, 'change file should not exist earlier than debounce time (second)');
                    }, TIMEOUT_CHANGE_DETECTED);
                }, TIMEOUT_CHANGE_DETECTED);
                setTimeout(function() {
                    assert(existsSync(changeFile), 'change file should exist after debounce time');
                }, debounceTime + debouncePadding);
            }, TIMEOUT_WATCH_READY);
        });

        it.skip('should replace {path} and {event} in command', function (done) {
            const timeToRun = TIMEOUT_WATCH_READY + TIMEOUT_CHANGE_DETECTED + 200;
            this.timeout(timeToRun + TIMEOUT_PADDING);

            const command = "echo '{event}:{path}' > " + changeFile;

            expectKilledByTimeout(run('node index.js "test/dir/a.js" -c "' + command + '"', timeToRun))
                .then(done, done);

            setTimeout(function() {
                writeFileSync(jsFile, 'content');
                setTimeout(function () {
                    var res = readFileSync(changeFile).toString().trim();
                    assert.equal(res, 'change:test/dir/a.js', 'need event/path detail');
                }, TIMEOUT_CHANGE_DETECTED);
            }, TIMEOUT_WATCH_READY);
        });

        afterEach(function () {
            deleteChangeFileSync()
            // TODO: should we depend on every system this runs in to have git?
            return run('git checkout HEAD test/dir', 1000);
        });
    });
});

/*
 * Test Helpers
 */

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

/** Flag for when a process is killed by the following helper */
const REASON_TIMEOUT = Symbol('REASON_TIMEOUT');

/**
 * Run a command. Returns a promise that resolves or rejects when the process finishes. The promise resolves when the
 * process finishes normally, and rejects when the process finishes abnormally (like being killed after a timeout).
 * @param {string} cmd - the command to run
 * @param {number} killTimeout - number of milliseconds to wait for the command to exit before killing it and
 * its children processes, defaults to 0.
 * @param {boolean} options.shouldInheritStdio - when set to true, the stdio will be piped to this processes stdio
 * which is useful for debugging but may cause zombie processes to stick around, defaults to false.
 * @returns {Promise}
 */
function run(cmd, killTimeout, { shouldInheritStdio = false } = {}) {
    let child;
    try {
        child = spawn(cmd, {
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
        function e(error) { child.removeListener('close', c); reject(error); }
        function c(exitCode, signal) {
            child.removeListener('error', e);
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
