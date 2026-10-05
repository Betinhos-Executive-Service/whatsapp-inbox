import { createModelDownloader } from "node-llama-cpp";
const d = await createModelDownloader({ modelUri: "https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/main/qwen2.5-3b-instruct-q4_k_m.gguf", dirPath: process.env.TEMP + "/wi-models", fileName: "qwen2.5-3b-instruct-q4_k_m.gguf", showCliProgress: false });
await d.download(); console.log("3B ok");
