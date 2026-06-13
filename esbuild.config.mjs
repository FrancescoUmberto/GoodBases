import esbuild from 'esbuild';
import { builtinModules } from 'node:module';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const prod = process.argv[2] === 'production';

/** Files Obsidian needs at the top level of the plugin folder. */
const PLUGIN_ASSETS = ['main.js', 'manifest.json', 'styles.css'];

/** Minimal .env parser (KEY=VALUE, optional quotes, # comments). */
function loadEnv() {
	if (!existsSync('.env')) return {};
	const env = {};
	for (const line of readFileSync('.env', 'utf8').split('\n')) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;
		const eq = trimmed.indexOf('=');
		if (eq === -1) continue;
		const key = trimmed.slice(0, eq).trim();
		let val = trimmed.slice(eq + 1).trim();
		if (val.startsWith('"') && val.endsWith('"')) {
			// Double-quoted: strip quotes and unescape (e.g. shell-escaped
			// `\ ` and `\~` in a pasted path become a plain space / tilde).
			val = val.slice(1, -1).replace(/\\(.)/g, '$1');
		} else if (val.startsWith("'") && val.endsWith("'")) {
			// Single-quoted: literal, no unescaping.
			val = val.slice(1, -1);
		}
		env[key] = val;
	}
	return env;
}

/** Expand a leading ~/ to the user's home directory. */
function expandHome(p) {
	if (p === '~') return homedir();
	if (p.startsWith('~/')) return path.join(homedir(), p.slice(2));
	return p;
}

/**
 * Copy the built plugin assets into the vault's plugin folder so the plugin can
 * be tested live. No-ops when OBSIDIAN_VAULT_PATH is unset (e.g. CI/release).
 * Warns rather than throwing so it never kills watch mode or fails a build.
 */
async function deployToVault() {
	const vaultRaw = loadEnv().OBSIDIAN_VAULT_PATH ?? process.env.OBSIDIAN_VAULT_PATH;
	if (!vaultRaw) return;

	const vault = expandHome(vaultRaw);
	if (!existsSync(vault)) {
		console.warn(`[good-bases] OBSIDIAN_VAULT_PATH does not exist, skipping deploy: ${vault}`);
		return;
	}

	try {
		const { id } = JSON.parse(await readFile('manifest.json', 'utf8'));
		const dest = path.join(vault, '.obsidian', 'plugins', id);
		await mkdir(dest, { recursive: true });
		await Promise.all(
			PLUGIN_ASSETS.map((f) => copyFile(f, path.join(dest, f))),
		);
		console.log(`[good-bases] deployed ${PLUGIN_ASSETS.join(', ')} → ${dest}`);
	} catch (e) {
		console.warn('[good-bases] failed to deploy to vault:', e.message);
	}
}

/** esbuild plugin: deploy after every successful (re)build, watch included. */
const deployPlugin = {
	name: 'deploy-to-vault',
	setup(build) {
		build.onEnd((result) => {
			if (result.errors.length === 0) return deployToVault();
		});
	},
};

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
	plugins: [deployPlugin],
});

if (prod) {
	await ctx.rebuild();
	await ctx.dispose();
	process.exit(0);
} else {
	await ctx.watch();
}
