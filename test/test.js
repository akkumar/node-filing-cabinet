var assert = require('assert');
var sinon = require('sinon');
var rewire = require('rewire');
var mock = require('mock-fs');
var path = require('path');

var cabinet = rewire('../');
// manually add dynamic imports to rewired app
cabinet.__set__('resolveDependencyPath', require('resolve-dependency-path'));
cabinet.__set__('resolve', require('resolve'));
cabinet.__set__('getModuleType', require('module-definition'));
cabinet.__set__('ts', require('typescript'));
cabinet.__set__('amdLookup', require('module-lookup-amd'));
cabinet.__set__('webpackResolve', require('enhanced-resolve'));

var mockedFiles = require('./mockedJSFiles');
var mockAST = require('./ast');

describe('filing-cabinet', () => {
  describe('JavaScript', () => {
    beforeEach(() => {
      mock(mockedFiles);
    });

    afterEach(() => {
      mock.restore();
    });

    it('dangles off its supported file extensions', () => {
      assert.deepEqual(cabinet.supportedFileExtensions, [
        '.js',
        '.jsx',
        '.ts',
        '.scss',
        '.sass',
        '.styl',
        '.less'
      ]);
    });

    it('uses a generic resolve for unsupported file extensions', () => {
      var stub = sinon.stub();
      var revert = cabinet.__set__('resolveDependencyPath', stub);

      cabinet({
        partial: './bar',
        filename: 'js/commonjs/foo.baz',
        directory: 'js/commonjs/'
      });

      assert.ok(stub.called);

      revert();
    });

    describe('when given an ast for a JS file', () => {
      it('reuses the ast when trying to determine the module type', () => {
        var stub = sinon.stub();
        var revert = cabinet.__set__('getModuleType', {
          fromSource: stub
        });
        var ast = {};

        cabinet({
          partial: './bar',
          filename: 'js/es6/foo.js',
          directory: 'js/es6/',
          ast
        });

        assert.deepEqual(stub.args[0][0], ast);
        revert();
      });

      it('resolves the partial successfully', () => {
        var result = cabinet({
          partial: './bar',
          filename: 'js/es6/foo.js',
          directory: 'js/es6/',
          ast: mockAST
        });

        assert.equal(result, path.join(__dirname, '../js/es6/bar.js'));
      });
    });

    describe('when not given an ast', () => {
      it('uses the filename to look for the module type', () => {
        var stub = sinon.stub();

        var revert = cabinet.__set__('getModuleType', {
          sync: stub
        });

        var options = {
          partial: './bar',
          filename: 'js/es6/foo.js',
          directory: 'js/es6/'
        };

        cabinet(options);

        assert.deepEqual(stub.args[0][0], options.filename);
        revert();
      });
    });

    describe('es6', () => {
      it('assumes commonjs for es6 modules with no requirejs/webpack config', () => {
        var stub = sinon.stub();
        var revert = cabinet.__set__('commonJSLookup', stub);

        cabinet({
          partial: './bar',
          filename: 'js/es6/foo.js',
          directory: 'js/es6/'
        });

        assert.ok(stub.called);

        revert();
      });

      it('assumes amd for es6 modules with a requirejs config', () => {
        var spy = sinon.spy(cabinet, '_getJSType');

        var result = cabinet({
          partial: './bar',
          filename: 'js/es6/foo.js',
          directory: 'js/es6/',
          config: {
            baseUrl: './'
          }
        });

        assert.ok(spy.called);
        assert.equal(result, 'js/es6/bar.js');
        spy.restore();
      });
    });

    describe('jsx', () => {
      it('resolves files with the .jsx extension', () => {
        const result = cabinet({
          partial: './bar',
          filename: 'js/es6/foo.jsx',
          directory: 'js/es6/'
        });

        assert.equal(result, `${path.join(__dirname, '../js/es6/bar.js')}`);
      });
    });

    describe('amd', () => {
      it('uses the amd resolver', () => {
        var stub = sinon.stub();
        var revert = cabinet.__set__('amdLookup', stub);

        cabinet({
          partial: './bar',
          filename: 'js/amd/foo.js',
          directory: 'js/amd/'
        });

        assert.ok(stub.called);

        revert();
      });

      it('passes along arguments', () => {
        var stub = sinon.stub();
        var revert = cabinet.__set__('amdLookup', stub);
        var config = {baseUrl: 'js'};

        cabinet({
          partial: 'bar',
          config,
          configPath: 'config.js',
          filename: 'js/amd/foo.js',
          directory: 'js/amd/'
        });

        var args = stub.getCall(0).args[0];

        assert.equal(args.partial, 'bar');
        assert.equal(args.config, config);
        assert.equal(args.configPath, 'config.js');
        assert.equal(args.filename, 'js/amd/foo.js');
        assert.equal(args.directory, 'js/amd/');

        assert.ok(stub.called);

        revert();
      });
    });

    describe('commonjs', () => {
      it('uses require\'s resolver', () => {
        var stub = sinon.stub();
        var revert = cabinet.__set__('commonJSLookup', stub);

        cabinet({
          partial: './bar',
          filename: 'js/commonjs/foo.js',
          directory: 'js/commonjs/'
        });

        assert.ok(stub.called);

        revert();
      });

      it('returns an empty string for an unresolved module', () => {
        var result = cabinet({
          partial: 'foobar',
          filename: 'js/commonjs/foo.js',
          directory: 'js/commonjs/'
        });

        assert.equal(result, '');
      });

      it('adds the directory to the require resolution paths', () => {
        var directory = 'js/commonjs/';
        cabinet({
          partial: 'foobar',
          filename: 'js/commonjs/foo.js',
          directory: directory
        });

        assert.ok(require.main.paths.some((p) => p.indexOf(directory) !== -1));
      });

      it('resolves a relative partial about the filename', () => {
        var directory = 'js/commonjs/';
        var filename = directory + 'foo.js';

        var result = cabinet({
          partial: './bar',
          filename: filename,
          directory: directory
        });

        assert.equal(result, path.join(path.resolve(directory), 'bar.js'));
      });

      it('resolves a .. partial to its parent directory\'s index.js file', () => {
        var directory = 'js/commonjs/';
        var filename = directory + 'subdir/module.js';

        var result = cabinet({
          partial: '../',
          filename: filename,
          directory: directory
        });

        assert.equal(result, path.join(path.resolve(directory), 'index.js'));
      });

      it('resolves a partial within a directory outside of the given file', () => {
        var directory = 'js/commonjs/';
        var filename = directory + 'test/index.spec.js';

        var result = cabinet({
          partial: 'subdir',
          filename: filename,
          directory: directory
        });

        assert.equal(result, path.join(path.resolve(directory), 'subdir/index.js'));
      });

      it('resolves a node module with module entry in package.json', () => {
        var directory = 'js/commonjs/';
        var filename = directory + 'module.entry.js';

        var result = cabinet({
          partial: 'module.entry',
          filename: filename,
          directory: directory,
          nodeModulesConfig: {
            entry: 'module'
          }
        });

        assert.equal(
          result,
          path.join(
            path.resolve(directory),
            '..',
            'node_modules',
            'module.entry',
            'index.module.js'
          )
        );
      });

      it('resolves a nested module', () => {
        var directory = 'js/node_modules/nested/';
        var filename = directory + 'index.js';

        var result = cabinet({
          partial: 'lodash.assign',
          filename: filename,
          directory: directory
        });

        assert.equal(
          result,
          path.join(
            path.resolve(directory),
            'node_modules',
            'lodash.assign',
            'index.js'
          )
        );
      });

      it('resolves to the index.js file of a directory', () => {
        var directory = 'js/withIndex';
        var filename = directory + '/index.js';

        var result = cabinet({
          partial: './subdir',
          filename: filename,
          directory: directory
        });

        assert.equal(
          result,
          path.resolve(directory) + '/subdir/index.js'
        );
      });

      it('resolves implicit .jsx requires', () => {
        const result = cabinet({
          partial: './bar',
          filename: 'js/cjs/foo.js',
          directory: 'js/cjs/'
        });

        assert.equal(result, `${path.join(__dirname, '../js/cjs/bar.jsx')}`);
      });
    });

    describe('typescript', () => {
      it('resolves an import', () => {
        var directory = 'js/ts';
        var filename = directory + '/index.ts';

        var result = cabinet({
          partial: './foo',
          filename,
          directory
        });

        assert.equal(
          result,
          path.join(path.resolve(directory), 'foo.ts')
        );
      });

      describe('when a partial does not exist', () => {
        it('returns an empty result', () => {
          var directory = 'js/ts';
          var filename = directory + '/index.ts';

          var result = cabinet({
            partial: './barbar',
            filename,
            directory
          });

          assert.equal(result, '');
        });
      });
    });
  });

  describe('CSS', () => {
    beforeEach(function() {
      mock({
        stylus: {
          'foo.styl': '',
          'bar.styl': ''
        },
        sass: {
          'foo.scss': '',
          'bar.scss': '',
          'foo.sass': '',
          'bar.sass': ''
        },
        less: {
          'foo.less': '',
          'bar.less': '',
          'bar.css': ''
        }
      });

      this._directory = path.resolve(__dirname, '../');
    });

    afterEach(() => {
      mock.restore();
    });

    describe('sass', () => {
      it('uses the sass resolver for .scss files', function() {
        const result = cabinet({
          partial: 'bar',
          filename: 'sass/foo.scss',
          directory: 'sass/'
        });

        assert.equal(result, `${this._directory}/sass/bar.scss`);
      });

      it('uses the sass resolver for .sass files', function() {
        const result = cabinet({
          partial: 'bar',
          filename: 'sass/foo.sass',
          directory: 'sass/'
        });

        assert.equal(result, `${this._directory}/sass/bar.sass`);
      });
    });

    describe('stylus', () => {
      it('uses the stylus resolver', function() {
        const result = cabinet({
          partial: 'bar',
          filename: 'stylus/foo.styl',
          directory: 'stylus/'
        });

        assert.equal(result, `${this._directory}/stylus/bar.styl`);
      });
    });

    describe('less', () => {
      it('resolves extensionless partials', function() {
        const result = cabinet({
          partial: 'bar',
          filename: 'less/foo.less',
          directory: 'less/'
        });

        assert.equal(result, `${this._directory}/less/bar.less`);
      });

      it('resolves partials with a less extension', function() {
        const result = cabinet({
          partial: 'bar.less',
          filename: 'less/foo.less',
          directory: 'less/'
        });

        assert.equal(result, `${this._directory}/less/bar.less`);
      });

      it('resolves partials with a css extension', function() {
        const result = cabinet({
          partial: 'bar.css',
          filename: 'less/foo.less',
          directory: 'less/'
        });

        assert.equal(result, `${this._directory}/less/bar.css`);
      });
    });
  });

  describe('.register', () => {
    it('registers a custom resolver for a given extension', () => {
      var stub = sinon.stub().returns('foo.foobar');
      cabinet.register('.foobar', stub);

      var localPath = cabinet({
        partial: './bar',
        filename: 'js/amd/foo.foobar',
        directory: 'js/amd/'
      });

      assert.ok(stub.called);
      assert.equal(localPath, 'foo.foobar');
    });

    it('allows does not break default resolvers', () => {
      mock({
        stylus: {
          'foo.styl': '',
          'bar.styl': ''
        }
      });

      var stub = sinon.stub().returns('foo');

      cabinet.register('.foobar', stub);

      cabinet({
        partial: './bar',
        filename: 'js/amd/foo.foobar',
        directory: 'js/amd/'
      });

      var result = cabinet({
        partial: './bar',
        filename: 'stylus/foo.styl',
        directory: 'stylus/'
      });

      assert.ok(stub.called);
      assert.ok(result);

      mock.restore();
    });

    it('can be called multiple times', () => {
      var stub = sinon.stub().returns('foo');
      var stub2 = sinon.stub().returns('foo');

      cabinet.register('.foobar', stub);
      cabinet.register('.barbar', stub2);

      cabinet({
        partial: './bar',
        filename: 'js/amd/foo.foobar',
        directory: 'js/amd/'
      });

      cabinet({
        partial: './bar',
        filename: 'js/amd/foo.barbar',
        directory: 'js/amd/'
      });

      assert.ok(stub.called);
      assert.ok(stub2.called);
    });

    it('does not add redundant extensions to supportedFileExtensions', () => {
      const stub = sinon.stub;
      const newExt = '.foobar';

      cabinet.register(newExt, stub);
      cabinet.register(newExt, stub);

      const {supportedFileExtensions} = cabinet;

      assert.equal(supportedFileExtensions.indexOf(newExt), supportedFileExtensions.lastIndexOf(newExt));
    });
  });

  describe('webpack', () => {
    let directory;

    beforeEach(() => {
      directory = path.resolve(__dirname, '../');
    });

    function testResolution(partial, expected) {
      const resolved = cabinet({
        partial,
        filename: `${directory}/index.js`,
        directory,
        webpackConfig: `${directory}/webpack.config.js`
      });

      assert.equal(resolved, expected);
    }

    it('resolves an aliased path', () => {
      testResolution('R', `${directory}/node_modules/resolve/index.js`);
    });

    it('resolves a non-aliased path', () => {
      testResolution('resolve', `${directory}/node_modules/resolve/index.js`);
    });

    it('resolves a relative path', () => {
      testResolution('./test/ast', `${directory}/test/ast.js`);
    });

    it('resolves an absolute path from a file within a subdirectory', () => {
      const resolved = cabinet({
        partial: 'R',
        filename: `${directory}/test/ast.js`,
        directory,
        webpackConfig: `${directory}/webpack.config.js`
      });

      assert.equal(resolved, `${directory}/node_modules/resolve/index.js`);
    });

    it('resolves a path using resolve.root', () => {
      const resolved = cabinet({
        partial: 'mod1',
        filename: `${directory}/index.js`,
        directory,
        webpackConfig: `${directory}/webpack-root.config.js`
      });

      assert.equal(resolved, `${directory}/test/root1/mod1.js`);
    });

    it('resolves NPM module when using resolve.root', () => {
      const resolved = cabinet({
        partial: 'resolve',
        filename: `${directory}/index.js`,
        directory,
        webpackConfig: `${directory}/webpack-root.config.js`
      });

      assert.equal(resolved, `${directory}/node_modules/resolve/index.js`);
    });

    it('resolves NPM module when using resolve.modulesDirectories', () => {
      const resolved = cabinet({
        partial: 'resolve',
        filename: `${directory}/index.js`,
        directory,
        webpackConfig: `${directory}/webpack-root.config.js`
      });

      assert.equal(resolved, `${directory}/node_modules/resolve/index.js`);
    });

    it('resolves a path using resolve.modulesDirectories', () => {
      const resolved = cabinet({
        partial: 'mod2',
        filename: `${directory}/index.js`,
        directory,
        webpackConfig: `${directory}/webpack-root.config.js`
      });

      assert.equal(resolved, `${directory}/test/root2/mod2.js`);
    });

    it('resolves a path using webpack config that exports a function', () => {
      const resolved = cabinet({
        partial: 'R',
        filename: `${directory}/index.js`,
        directory,
        webpackConfig: `${directory}/webpack-env.config.js`
      });

      assert.equal(resolved, `${directory}/node_modules/resolve/index.js`);
    });

    it('resolves files with a .jsx extension', () => {
      testResolution('./test/foo.jsx', `${directory}/test/foo.jsx`);
    });

    describe('when the partial contains a loader', () => {
      it('still works', () => {
        testResolution('hgn!resolve', `${directory}/node_modules/resolve/index.js`);
      });
    });
  });
});
