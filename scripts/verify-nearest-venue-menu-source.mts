import { SearchPipeline } from '../packages/core/src/search/pipeline.ts';

const query = process.argv.slice(2).join(' ')
  || "can you find meny of jønk' burgers closest to bygøy";
const response = await new SearchPipeline().search(query);
console.log(JSON.stringify({
  answer: response.answer,
  sources: response.sources.map((source) => ({
    title: source.title,
    url: source.url,
    trust: source.trust,
    text: source.text.slice(0, 320),
  })),
  plan: response.plan,
  audit: response.audit,
}, null, 2));
