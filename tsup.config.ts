import { defineConfig } from 'tsup';

export default defineConfig({
  // エントリは CLI のみ
  entry: ['src/cli.ts'],

  // CommonJS で出力
  format: ['cjs'],

  outDir: 'dist',
  splitting: false,      // 単一ファイル化
  sourcemap: true,
  dts: true,             // 型定義も出力
  minify: true,

  // shebang を先頭に入れる
  banner: {
    js: '#!/usr/bin/env node'
  },

  esbuildOptions(options) {
    // Node 環境向けでバンドル
    options.platform = 'node';
  },

  // CJS 出力は .cjs 拡張子に置き換える
  outExtension({ format }) {
    if (format === 'cjs') {
      return { js: '.cjs' };
    }
    return {};
  }
});