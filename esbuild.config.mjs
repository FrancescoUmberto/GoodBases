import esbuild from 'esbuild';
import { builtinModules } from 'node:module';

const prod = process.argv[2] === 'production';

const ctx = await esbuild.context({
	entryPoints: ['src/main.ts'],
	bundle: true,
	external: [
		'obsidian',
		'electron',
		'@codemirror/*',
		'@lezer/*',
		...builtinModules,
		...builtinModules.map((m) => `node:${m}`),
	],
	format: 'cjs',
	target: 'es2020',
	logLevel: 'info',
	sourcemap: prod ? false : 'inline',
	treeShaking: true,
	outfile: 'main.js',
});

if (prod) {
	await ctx.rebuild();
	process.exit(0);
} else {
	await ctx.watch();
}
