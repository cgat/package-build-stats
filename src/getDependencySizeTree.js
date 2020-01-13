const path = require('path')
const Terser = require('terser')

/**
 * A fork of `webpack-bundle-size-analyzer`.
 * https://github.com/robertknight/webpack-bundle-size-analyzer
 */

function modulePath(identifier) {
  // the format of module paths is
  //   '(<loader expression>!)?/path/to/module.js'
  let loaderRegex = /.*!/
  return identifier.replace(loaderRegex, '')
}

function getByteLen(normal_val) {
  // Force string type
  normal_val = String(normal_val)

  var byteLen = 0
  for (var i = 0; i < normal_val.length; i++) {
    var c = normal_val.charCodeAt(i)
    byteLen +=
      c < 1 << 7
        ? 1
        : c < 1 << 11
        ? 2
        : c < 1 << 16
        ? 3
        : c < 1 << 21
        ? 4
        : c < 1 << 26
        ? 5
        : c < 1 << 31
        ? 6
        : Number.NaN
  }
  return byteLen
}

function bundleSizeTree(stats, isLocal) {
  let statsTree = {
    packageName: '<root>',
    sources: [],
    children: [],
  }

  if (stats.name) {
    statsTree.bundleName = stats.name
  }

  if (!stats.modules) return []

  // extract source path for each module
  let modules = []
  const makeModule = mod => {
    // Uglifier cannot minify a json file, hence we need
    // to make it valid javascript syntax
    const isJSON = mod.identifier.endsWith('.json')
    const source = isJSON ? `$a$=${mod.source}` : mod.source

    return {
      path: modulePath(mod.identifier),
      sources: [source],
      source: source,
    }
  }

  stats.modules
    .filter(mod => !mod.name.startsWith('external'))
    .forEach(mod => {
      if (mod.modules) {
        mod.modules.forEach(subMod => {
          modules.push(makeModule(subMod))
        })
      } else {
        modules.push(makeModule(mod))
      }
    })

  modules.sort((a, b) => {
    if (a === b) {
      return 0
    } else {
      return a < b ? -1 : 1
    }
  })

  modules.forEach(mod => {
    let packages = mod.path.split(
      new RegExp('\\' + path.sep + 'node_modules\\' + path.sep)
    )
    if (packages.length > 1) {
      let lastSegment = packages.pop()
      let lastPackageName = ''
      if (lastSegment[0] === '@') {
        // package is a scoped package
        let offset = lastSegment.indexOf(path.sep) + 1
        lastPackageName = lastSegment.slice(
          0,
          offset + lastSegment.slice(offset).indexOf(path.sep)
        )
      } else {
        lastPackageName = lastSegment.slice(0, lastSegment.indexOf(path.sep))
      }
      packages.push(lastPackageName)
    }
    // Removes the `/tmp/tmp-build...` from the split list
    packages.shift()
    if (isLocal) {
      // If this is a local install, the file structure is slightly different.
      // Remote: `/tmp/tmp-build/<installPath>/node_modules` contains all the modules
      // in a flat directory.
      // Local: `/tmp/tmp-build/<installPath>/node_modules` is a link to the local module
      // (named <packageName>),which also contains a `node_modules` directory (the one with the deps). This means
      // there is an extra `node_modules` in the path that we need to account for.
      packages.shift()
    }

    let parent = statsTree
    parent.sources.push(mod.source)
    packages.forEach(pkg => {
      let existing = parent.children.filter(child => child.packageName === pkg)
      if (existing.length > 0) {
        existing[0].sources.push(mod.source)
        parent = existing[0]
      } else {
        let newChild = {
          path: mod.path,
          packageName: pkg,
          sources: [mod.source],
          children: [],
        }
        parent.children.push(newChild)
        parent = newChild
      }
    })
  })

  const results = statsTree.children
    .map(treeItem => ({
      ...treeItem,
      sources: treeItem.sources.filter(source => !!source),
    }))
    .filter(treeItem => treeItem.sources.length)
    .map(treeItem => {
      const size = treeItem.sources.reduce((acc, source) => {
        const uglifiedSource = Terser.minify(source, {
          mangle: false,
          compress: {
            arrows: true,
            booleans: true,
            collapse_vars: true,
            comparisons: true,
            conditionals: true,
            dead_code: true,
            drop_console: false,
            drop_debugger: true,
            ecma: 5,
            evaluate: true,
            expression: false,
            global_defs: {},
            hoist_vars: false,
            ie8: false,
            if_return: true,
            inline: true,
            join_vars: true,
            keep_fargs: true,
            keep_fnames: false,
            keep_infinity: false,
            loops: true,
            negate_iife: true,
            passes: 1,
            properties: true,
            pure_getters: 'strict',
            pure_funcs: null,
            reduce_vars: true,
            sequences: true,
            side_effects: true,
            switches: true,
            top_retain: null,
            toplevel: false,
            typeofs: true,
            unsafe: false,
            unused: true,
            warnings: false,
          },
          output: {
            comments: false,
          },
        })

        if (uglifiedSource.error) {
          throw new Error('Uglifying failed' + uglifiedSource.error)
        }

        return acc + getByteLen(uglifiedSource.code)
      }, 0)

      return {
        name: treeItem.packageName,
        approximateSize: size,
      }
    })

  return results
}

module.exports = bundleSizeTree
