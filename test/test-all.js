// Test basic usage of cli. Contains confusing setTimeouts

const { unlinkSync, writeFileSync, readFileSync, existsSync } = require('fs');
const { resolve: pathResolve, join: pathJoin } = require('path');
const assert = require('assert');
const { run } = require('../utils');

// If true, output of commands are shown
const DEBUG_TESTS = false;

// Arbitrary file which is created on detected changes
// Used to determine that file changes were actually detected.
const CHANGE_FILE = 'dir/change';

// Time to wait for different tasks
const TIMEOUT_WATCH_READY = 1000;
const TIMEOUT_CHANGE_DETECTED = 700;
const TIMEOUT_KILL = TIMEOUT_WATCH_READY + TIMEOUT_CHANGE_DETECTED + 1000;

// Abs path to test directory
const testDir = pathResolve(__dirname);
process.chdir(pathJoin(testDir, '..'));

describe('chokidar-cli', function() {
    this.timeout(5000);

    afterEach(function clean(done) {
        if (changeFileExists()) {
            unlinkSync(resolve(CHANGE_FILE));
        }

        // Clear all changes in the test directory
        run('git checkout HEAD dir', {cwd: testDir})
        .then(function() {
            done();
        });
    });

    it('help should be succesful', function(done) {
        run('node index.js --help', {pipe: DEBUG_TESTS})
        .then(function(exitCode) {
            // exit code 0 means success
            assert.strictEqual(exitCode, 0);
            done();
        });
    });

    it('version should be successful', function(done) {
        run('node index.js -v', {pipe: DEBUG_TESTS})
        .then(function(exitCode) {
            // exit code 0 means success
            assert.strictEqual(exitCode, 0);
            done();
        });
    });

    it('**/*.less should detect all less files in dir tree', function(done) {
        var killed = false;

        // Use a file to detect that trigger command is actually run
        var touch = 'touch ' + CHANGE_FILE;

        // No quotes needed in glob pattern because node process spawn
        // does no globbing
        // TODO: touch command does not always create file before assertion
        run('node ../index.js "dir/**/*.less" -c "' + touch + '"', {
            pipe: DEBUG_TESTS,
            cwd: './test',
            // Called after process is spawned
            callback: function(child) {
                setTimeout(function killChild() {
                    // Kill child after test case
                    child.kill();
                    killed = true;
                }, TIMEOUT_KILL);
            }
        })
        .then(function childProcessExited(exitCode) {
            // Process should be killed after a timeout,
            // test if the process died unexpectedly before it
            assert(killed, 'process exited too quickly');
            done();
        });

        setTimeout(function afterWatchIsReady() {
            writeFileSync(resolve('dir/subdir/c.less'), 'content');

            setTimeout(function() {
                assert(changeFileExists(), 'change file should exist');
            }, TIMEOUT_CHANGE_DETECTED);
        }, TIMEOUT_WATCH_READY);
    });

    it('should throttle invocations of command', function(done) {
        const touch = 'touch ' + CHANGE_FILE;
        const changedDetectedTime = 100;
        const throttleTime = (2 * changedDetectedTime) + 100;

        run('node ../index.js "dir/**/*.less" --debounce 0 --throttle ' + throttleTime + ' -c "' + touch + '"', {
            pipe: DEBUG_TESTS,
            cwd: './test',
            callback: function(child) {
                setTimeout(function killChild() {
                    // Kill child after test case
                    child.kill();
                }, TIMEOUT_KILL);
            }
        })
        .then(function childProcessExited(exitCode) {
            done();
        })
        .catch(done);

        setTimeout(function afterWatchIsReady() {
            writeFileSync(resolve('dir/subdir/c.less'), 'content');
            setTimeout(function() {
                assert(changeFileExists(), 'change file should exist after first change');
                unlinkSync(resolve(CHANGE_FILE));
                writeFileSync(resolve('dir/subdir/c.less'), 'more content');
                setTimeout(function() {
                    assert.equal(changeFileExists(), false, 'change file should not exist after second change');
                }, changedDetectedTime);
            }, changedDetectedTime);
        }, TIMEOUT_WATCH_READY);
    });

    it('should debounce invocations of command', function(done) {
        const touch = 'touch ' + CHANGE_FILE;
        const changedDetectedTime = 100;
        const debounceTime = (2 * changedDetectedTime) + 100;
        const killTime = TIMEOUT_WATCH_READY + (2 * changedDetectedTime) + debounceTime + 1000;

        run('node ../index.js "dir/**/*.less" --debounce ' + debounceTime + ' -c "' + touch + '"', {
            pipe: DEBUG_TESTS,
            cwd: './test',
            callback: function(child) {
                setTimeout(function killChild() {
                    // Kill child after test case
                    child.kill();
                }, killTime);
            }
        })
        .then(function childProcessExited(exitCode) {
            done();
        })
        .catch(done);

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

    it('should replace {path} and {event} in command', function(done) {
        const command = "echo '{event}:{path}' > " + CHANGE_FILE;

        setTimeout(function() {
          writeFileSync(resolve('dir/a.js'), 'content');
        }, TIMEOUT_WATCH_READY);

        run('node ../index.js "dir/a.js" -c "' + command + '"', {
            pipe: DEBUG_TESTS,
            cwd: './test',
            callback: function(child) {
                setTimeout(child.kill.bind(child), TIMEOUT_KILL);
            }
        })
        .then(function() {
            var res = readFileSync(resolve(CHANGE_FILE)).toString().trim();
            assert.equal(res, 'change:dir/a.js', 'need event/path detail');
            done();
        });
    });
});

function resolve(relativePath) {
    return pathJoin(testDir, relativePath);
}

function changeFileExists() {
    return existsSync(resolve(CHANGE_FILE));
}
