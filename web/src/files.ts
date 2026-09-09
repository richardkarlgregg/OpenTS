/*******************************************************************************
 *                                O P E N T S
 *******************************************************************************
 * SPDX-License-Identifier: GPL-3.0-or-later
 * Copyright 2026 OpenTS contributors
 *
 * See LICENSE.md for applicable additional terms and warranty disclaimers.
 ******************************************************************************/

export class GameDirectory {
	readonly name: string;
	private readonly files = new Map<string, File>();
	private readonly by_name = new Map<string, string>();

	constructor(name: string) {
		this.name = name;
	}

	add(path: string, file: File): void {
		const key = normalize_path(path);
		this.files.set(key, file);
		const base = basename(key);
		if (!this.by_name.has(base)) {
			this.by_name.set(base, key);
		}
	}

	get(path: string): File | undefined {
		const key = normalize_path(path);
		const direct = this.files.get(key);
		if (direct) {
			return direct;
		}
		const mapped = this.by_name.get(basename(key));
		return mapped ? this.files.get(mapped) : undefined;
	}

	list(suffix = ""): string[] {
		const needle = suffix.toLowerCase();
		const names: string[] = [];
		for (const name of this.files.keys()) {
			if (name.endsWith(needle)) {
				names.push(name);
			}
		}
		names.sort();
		return names;
	}

	async read(path: string): Promise<Uint8Array | null> {
		const file = this.get(path);
		if (!file) {
			return null;
		}
		return new Uint8Array(await file.arrayBuffer());
	}

	async read_slice(path: string, start: number, size: number): Promise<Uint8Array | null> {
		const file = this.get(path);
		if (!file) {
			return null;
		}
		const end = Math.min(file.size, start + size);
		if (start >= file.size) {
			return null;
		}
		return new Uint8Array(await file.slice(start, end).arrayBuffer());
	}

	async file_size(path: string): Promise<number | null> {
		const file = this.get(path);
		if (!file) {
			return null;
		}
		return file.size;
	}
}

export function directory_from_file_list(files: FileList): GameDirectory {
	if (files.length === 0) {
		throw new Error("No files were selected.");
	}
	const first = files[0]!;
	const root = root_name(first);
	const directory = new GameDirectory(root);
	for (const file of files) {
		directory.add(relative_path(file), file);
	}
	return directory;
}

export async function pick_game_directory(): Promise<GameDirectory> {
	if (typeof window.showDirectoryPicker !== "function") {
		throw new Error("This browser has no folder picker. Use Chromium.");
	}
	const root = await window.showDirectoryPicker({ mode: "read" });
	const directory = new GameDirectory(root.name);
	await walk_directory(root, "", directory);
	return directory;
}

function normalize_path(path: string): string {
	return path.replaceAll("\\", "/").toLowerCase();
}

function basename(path: string): string {
	const parts = path.split("/");
	return parts[parts.length - 1] ?? path;
}

function root_name(file: File): string {
	const rel = file.webkitRelativePath.replaceAll("\\", "/");
	if (!rel) {
		return file.name;
	}
	return rel.split("/")[0] ?? file.name;
}

function relative_path(file: File): string {
	const rel = file.webkitRelativePath.replaceAll("\\", "/");
	if (!rel) {
		return file.name;
	}
	const slash = rel.indexOf("/");
	return slash >= 0 ? rel.slice(slash + 1) : rel;
}

async function walk_directory(
	dir: FileSystemDirectoryHandle,
	prefix: string,
	out: GameDirectory,
	depth = 0,
): Promise<void> {
	if (depth > 6) {
		return;
	}
	for await (const [name, handle] of directory_entries(dir)) {
		const path = prefix ? `${prefix}/${name}` : name;
		if (handle.kind === "file") {
			out.add(path, await (handle as FileSystemFileHandle).getFile());
		} else if (handle.kind === "directory") {
			const skip = name.startsWith(".") || name === "node_modules";
			if (!skip) {
				await walk_directory(handle as FileSystemDirectoryHandle, path, out, depth + 1);
			}
		}
	}
}

async function* directory_entries(
	dir: FileSystemDirectoryHandle,
): AsyncGenerator<[string, FileSystemHandle]> {
	const iterable = dir as unknown as {
		entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
	};
	for await (const entry of iterable.entries()) {
		yield entry;
	}
}
