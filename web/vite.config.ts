import { defineConfig } from "vite";

export default defineConfig({
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
