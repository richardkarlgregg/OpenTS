// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright 2026 OpenTS contributors

import { terrain_defaults, type TerrainRenderer, type TerrainSettings } from "./terrain-renderer";

type TileExport = { name:string; path:string; export:(progress:(value:number)=>void,cancelled:()=>boolean)=>Promise<Blob> };

export class TerrainControls {
	readonly element = document.createElement("section");
	private readonly mode = document.createElement("button");
	private readonly export_button = document.createElement("button");
	private readonly tile_button = document.createElement("button");
	private readonly save = document.createElement("a");
	private readonly status = document.createElement("span");
	private readonly debug = document.createElement("details");
	private readonly tile_menu = document.createElement("div");
	private readonly selected_export = document.createElement("button");
	private readonly refresh: (() => void)[] = [];
	private url = "";
	private exporting = false;
	private disposed = false;

	constructor(canvas: HTMLCanvasElement, settings: TerrainSettings, private readonly theater: string,
		private readonly renderer: () => TerrainRenderer | null, toggle: () => void,
		private readonly export_tiles?: (progress:(value:number)=>void,cancelled:()=>boolean)=>Promise<Blob>) {
		this.element.className = "terrain-tools";
		this.element.setAttribute("aria-label", "Terrain graphics");
		this.mode.type = "button"; this.mode.onclick = toggle;
		this.mode.setAttribute("aria-pressed", "false"); this.mode.textContent = "Remaster: off (V)";
		this.export_button.type = "button"; this.export_button.textContent = "Export whole map";
		this.export_button.onclick = () => { void this.prepare_export(); };
		this.tile_button.type="button";this.tile_button.textContent="Export tile kit (PNG + GLB)";
		this.tile_button.onclick=()=>{void this.prepare_export(true);};this.tile_button.hidden=!export_tiles;
		this.save.textContent = "Save .gltf"; this.save.hidden = true;
		this.status.setAttribute("role", "status");
		const bar = document.createElement("div"); bar.className = "terrain-toolbar";
		bar.append(this.mode, this.tile_button, this.export_button, this.save, this.status);
		const summary = document.createElement("summary"); summary.textContent = "Terrain debug";
		const fields = document.createElement("div"); fields.className = "terrain-debug-fields";
		const note = document.createElement("p"); note.textContent = "Enable Remaster to preview these settings. Shadows affect terrain meshes; sprites keep their original shadows.";
		const checkbox = (key: keyof TerrainSettings, title: string): void => {
			const label = document.createElement("label"), input = document.createElement("input");
			input.type = "checkbox"; input.checked = Boolean(settings[key]);
			input.onchange = () => { Object.assign(settings, { [key]: input.checked }); };
			this.refresh.push(() => { input.checked = Boolean(settings[key]); });
			label.append(input, ` ${title}`); fields.append(label);
		};
		checkbox("textures", "Textures"); checkbox("lighting", "Directional lighting"); checkbox("shadows", "Terrain shadows");
		checkbox("map_tint", "Map lighting / tint"); checkbox("wireframe", "Wireframe"); checkbox("normals", "Surface normals");
		const slider = (key: "azimuth" | "elevation" | "ambient", title: string, min: number, max: number, step: number): void => {
			const label = document.createElement("label"), input = document.createElement("input"), value = document.createElement("output");
			input.type = "range"; input.min = String(min); input.max = String(max); input.step = String(step);
			const sync = () => { input.value = String(settings[key]); value.textContent = key === "ambient" ? `${Math.round(settings[key] * 100)}%` : `${settings[key]}°`; };
			input.oninput = () => { settings[key] = Number(input.value); sync(); };
			this.refresh.push(sync); sync(); label.append(`${title} `, input, value); fields.append(label);
		};
		slider("azimuth", "Sun direction", 0, 360, 5); slider("elevation", "Sun elevation", 10, 85, 5); slider("ambient", "Ambient light", 0.1, 1, 0.05);
		const reset = document.createElement("button"); reset.type = "button"; reset.textContent = "Reset lighting and debug";
		reset.onclick = () => { Object.assign(settings, terrain_defaults()); this.refresh.forEach(fn => fn()); };
		fields.append(reset); this.debug.append(summary, note, fields); this.element.append(bar, this.debug);
		this.tile_menu.className="terrain-tile-menu"; this.tile_menu.hidden=true;
		this.tile_menu.setAttribute("role","dialog"); this.tile_menu.setAttribute("aria-label","Terrain tile");
		this.element.append(this.tile_menu);
		// Debug controls must not issue tactical keyboard or mouse commands.
		for (const event of ["keydown", "keyup", "mousedown", "mouseup"]) this.element.addEventListener(event, e => {
			if(e instanceof KeyboardEvent && e.key==="Escape" && this.menu_open) { e.preventDefault(); this.close_tile(); }
			if (e instanceof KeyboardEvent && (e.code === "KeyV" || (e.code === "KeyE" && e.ctrlKey && e.shiftKey))) return;
			e.stopPropagation();
		});
		canvas.before(this.element);
	}

	set_mode(enabled: boolean): void {
		this.close_tile();
		this.mode.textContent = enabled ? "Remaster: on (V)" : "Remaster: off (V)";
		this.mode.setAttribute("aria-pressed", String(enabled));
	}

	get menu_open(): boolean { return !this.tile_menu.hidden; }

	close_tile(): void { this.tile_menu.hidden=true; }

	show_tile(name:string, path:string, x:number, y:number, exporter:TileExport["export"]): void {
		if(this.disposed) return;
		const title=document.createElement("strong"), destination=document.createElement("p"), help=document.createElement("p"), close=document.createElement("button");
		title.textContent=name; destination.textContent=`Save edited GLB to: ${path}`;
		help.textContent="Keep the tile origin and scale. Reload the mission to use it for all matching tiles in Remaster mode.";
		const selection:TileExport={name,path,export:exporter};
		this.selected_export.type="button"; this.selected_export.textContent="Export this tile (PNG + GLB)";
		this.selected_export.disabled=this.exporting;
		this.selected_export.onclick=()=>{void this.prepare_export(true,selection);};
		close.type="button"; close.textContent="Close"; close.onclick=()=>this.close_tile();
		this.tile_menu.replaceChildren(title,destination,help,this.selected_export,close); this.tile_menu.hidden=false;
		this.tile_menu.style.left=`${Math.max(8,Math.min(x,window.innerWidth-this.tile_menu.offsetWidth-8))}px`;
		this.tile_menu.style.top=`${Math.max(8,Math.min(y,window.innerHeight-this.tile_menu.offsetHeight-8))}px`;
		this.selected_export.focus();
	}

	async prepare_export(tiles = false, selection?:TileExport): Promise<void> {
		if (this.exporting || this.disposed) return;
		this.exporting = true; this.export_button.disabled = this.tile_button.disabled = this.selected_export.disabled = true;
		this.status.textContent = "Preparing terrain export…";
		try {
			await new Promise<void>(resolve => setTimeout(resolve, 0));
			if (this.disposed) return;
			const progress = (fraction:number) => {
				if (!this.disposed) this.status.textContent = `Preparing terrain export: ${Math.round(fraction * 100)}%`;
			};
			let blob:Blob;
			if(selection)blob=await selection.export(progress,()=>this.disposed);
			else if(tiles && this.export_tiles)blob=await this.export_tiles(progress,()=>this.disposed);
			else {
				const renderer=this.renderer();if(!renderer)throw new Error("3D terrain is unavailable. Check the page log.");
				blob=await renderer.export_blob(this.theater,progress,()=>this.disposed);
			}
			if (this.disposed) return;
			if (this.url) URL.revokeObjectURL(this.url);
			this.url = URL.createObjectURL(blob); this.save.href = this.url;
			this.save.download = `${this.theater.toLowerCase()}-${selection?selection.name.replace(/[^a-z0-9_.-]/gi,"-")+".zip":tiles?"tiles.zip":"terrain.gltf"}`; this.save.hidden = false;
			this.save.textContent=selection?"Save selected tile.zip":tiles?"Save tile kit.zip":"Save .gltf";
			this.status.textContent = selection?`Ready: ${selection.name}. Save and extract the ZIP. Place the edited GLB at ${selection.path}.`:`Ready (${(blob.size / 1048576).toFixed(1)} MB). ${tiles?"Save and extract the kit; each tile has a PNG reference and editable GLB.":"Click Save .gltf, then import it in Blender."}`;
			if(selection) this.close_tile();
		} catch (error) {
			if (!this.disposed) this.status.textContent = `Export failed: ${error instanceof Error ? error.message : String(error)}`;
		} finally {
			this.exporting = false; this.export_button.disabled = this.tile_button.disabled = this.selected_export.disabled = false;
		}
	}

	dispose(): void {
		this.disposed = true; this.element.remove();
		if (this.url) URL.revokeObjectURL(this.url);
	}
}
