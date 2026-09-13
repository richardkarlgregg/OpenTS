import { defineConfig } from "vite";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

function remaster_manifest(root: string) {
	const files: {path:string;revision:string}[]=[];
	const walk=(folder:string,prefix:string)=>{
		if(!existsSync(folder))return;
		for(const entry of readdirSync(folder,{withFileTypes:true})) {
			if(entry.isSymbolicLink())continue;
			const path=prefix+entry.name, full=join(folder,entry.name);
			if(entry.isDirectory())walk(full,`${path}/`);
			else if(/^tiles\/[a-z0-9_.-]+\/[a-z0-9_.-]+\/[0-9]+\.glb$/i.test(path)) {
				const stat=statSync(full);files.push({path,revision:`${stat.mtimeMs}-${stat.size}`});
			}
		}
	};
	walk(root,"");files.sort((a,b)=>a.path.localeCompare(b.path));return {version:1,files};
}

export default defineConfig({
	plugins: [{
		name:"opents-remaster-tiles",
		configureServer(server) {
			server.middlewares.use((req,res,next)=>{
				if(req.url?.split("?")[0]!=="/remaster/manifest.json")return next();
				res.setHeader("Content-Type","application/json");res.setHeader("Cache-Control","no-store");
				res.end(JSON.stringify(remaster_manifest(resolve(server.config.publicDir,"remaster"))));
			});
		},
		generateBundle() {this.emitFile({type:"asset",fileName:"remaster/manifest.json",source:JSON.stringify(remaster_manifest(resolve("public/remaster")))});},
	}],
	server: {
		host: "::",
		port: 5173,
		strictPort: true,
		fs: {
			allow: [".."],
		},
	},
	build: {
		outDir: "dist",
		emptyOutDir: true,
	},
});
