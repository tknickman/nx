import { readTsConfig } from '@nrwl/workspace/src/utilities/typescript';
import { LicenseWebpackPlugin } from 'license-webpack-plugin';
import { TsconfigPathsPlugin } from 'tsconfig-paths-webpack-plugin';
import * as ts from 'typescript';
import type { Configuration, WebpackPluginInstance } from 'webpack';
import * as webpack from 'webpack';
import { loadTsTransformers } from './load-ts-transformers';
import { BuildBuilderOptions } from './types';
import CopyWebpackPlugin = require('copy-webpack-plugin');
import ForkTsCheckerWebpackPlugin = require('fork-ts-checker-webpack-plugin');
import { removeExt } from '@nrwl/workspace/src/utils/runtime-lint-utils';

export const OUT_FILENAME_TEMPLATE = '[name].js';

export function getBaseWebpackPartial(
  options: BuildBuilderOptions
): Configuration {
  const { options: compilerOptions } = readTsConfig(options.tsConfig);
  const supportsEs2015 =
    compilerOptions.target !== ts.ScriptTarget.ES3 &&
    compilerOptions.target !== ts.ScriptTarget.ES5;
  const mainFields = [...(supportsEs2015 ? ['es2015'] : []), 'module', 'main'];
  const extensions = ['.ts', '.tsx', '.mjs', '.js', '.jsx'];

  const { compilerPluginHooks, hasPlugin } = loadTsTransformers(
    options.transformers
  );

  const additionalEntryPoints =
    options.additionalEntryPoints?.reduce(
      (obj, current) => ({
        ...obj,
        [current.entryName]: current.entryPath,
      }),
      {} as { [entryName: string]: string }
    ) ?? {};
  const mainEntry = options.outputFileName
    ? removeExt(options.outputFileName)
    : 'main';
  const webpackConfig: Configuration = {
    entry: {
      [mainEntry]: [options.main],
      ...additionalEntryPoints,
    },
    devtool: options.sourceMap ? 'source-map' : false,
    mode: options.optimization ? 'production' : 'development',
    output: {
      path: options.outputPath,
      filename:
        options.additionalEntryPoints?.length > 0
          ? OUT_FILENAME_TEMPLATE
          : options.outputFileName,
      hashFunction: 'xxhash64',
      // Disabled for performance
      pathinfo: false,
    },
    module: {
      // Enabled for performance
      unsafeCache: true,
      rules: [
        {
          test: /\.([jt])sx?$/,
          loader: require.resolve(`ts-loader`),
          exclude: /node_modules/,
          options: {
            configFile: options.tsConfig,
            transpileOnly: !hasPlugin,
            // https://github.com/TypeStrong/ts-loader/pull/685
            experimentalWatchApi: true,
            getCustomTransformers: (program) => ({
              before: compilerPluginHooks.beforeHooks.map((hook) =>
                hook(program)
              ),
              after: compilerPluginHooks.afterHooks.map((hook) =>
                hook(program)
              ),
              afterDeclarations: compilerPluginHooks.afterDeclarationsHooks.map(
                (hook) => hook(program)
              ),
            }),
          },
        },
      ],
    },
    resolve: {
      extensions,
      alias: getAliases(options),
      plugins: [
        new TsconfigPathsPlugin({
          configFile: options.tsConfig,
          extensions,
          mainFields,
        }) as never, // TODO: Remove never type when 'tsconfig-paths-webpack-plugin' types fixed
      ],
      mainFields,
    },
    performance: {
      hints: false,
    },
    plugins: [
      new ForkTsCheckerWebpackPlugin({
        // For watch mode, type errors should result in failure.
        async: false,
        typescript: {
          configFile: options.tsConfig,
          memoryLimit: options.memoryLimit || 2018,
        },
      }),
    ],
    watch: options.watch,
    watchOptions: {
      // Delay the next rebuild from first file change, otherwise can lead to
      // two builds on a single file change.
      aggregateTimeout: 200,
      poll: options.poll,
      ...options.watchOptions,
    },
    stats: getStatsConfig(options),
    experiments: {
      cacheUnaffected: true,
    },
  };

  const extraPlugins: WebpackPluginInstance[] = [];

  if (options.progress) {
    extraPlugins.push(new webpack.ProgressPlugin());
  }

  if (options.extractLicenses) {
    extraPlugins.push(
      new LicenseWebpackPlugin({
        stats: {
          errors: false,
        },
        perChunkOutput: false,
        outputFilename: `3rdpartylicenses.txt`,
      }) as unknown as WebpackPluginInstance
    );
  }

  // process asset entries
  if (Array.isArray(options.assets) && options.assets.length > 0) {
    const copyWebpackPluginInstance = new CopyWebpackPlugin({
      patterns: options.assets.map((asset) => {
        return {
          context: asset.input,
          // Now we remove starting slash to make Webpack place it from the output root.
          to: asset.output,
          from: asset.glob,
          globOptions: {
            ignore: [
              '.gitkeep',
              '**/.DS_Store',
              '**/Thumbs.db',
              ...(asset.ignore ?? []),
            ],
            dot: true,
          },
        };
      }),
    });

    new CopyWebpackPlugin({
      patterns: options.assets.map((asset: any) => {
        return {
          context: asset.input,
          // Now we remove starting slash to make Webpack place it from the output root.
          to: asset.output,
          from: asset.glob,
          globOptions: {
            ignore: [
              '.gitkeep',
              '**/.DS_Store',
              '**/Thumbs.db',
              ...(asset.ignore ?? []),
            ],
            dot: true,
          },
        };
      }),
    });
    extraPlugins.push(copyWebpackPluginInstance);
  }

  webpackConfig.plugins = [...webpackConfig.plugins, ...extraPlugins];

  return webpackConfig;
}

function getAliases(options: BuildBuilderOptions): { [key: string]: string } {
  return options.fileReplacements.reduce(
    (aliases, replacement) => ({
      ...aliases,
      [replacement.replace]: replacement.with,
    }),
    {}
  );
}

function getStatsConfig(options: BuildBuilderOptions) {
  return {
    hash: true,
    timings: false,
    cached: false,
    cachedAssets: false,
    modules: false,
    warnings: true,
    errors: true,
    colors: !options.verbose && !options.statsJson,
    chunks: !options.verbose,
    assets: !!options.verbose,
    chunkOrigins: !!options.verbose,
    chunkModules: !!options.verbose,
    children: !!options.verbose,
    reasons: !!options.verbose,
    version: !!options.verbose,
    errorDetails: !!options.verbose,
    moduleTrace: !!options.verbose,
    usedExports: !!options.verbose,
  };
}
