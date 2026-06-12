// One-shot asset generator: pulls painterly sprites from the OpenAI Images API
// and drops them into public/assets/. Run: OPENAI_API_KEY=... node tools/generate-assets.mjs
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const KEY = process.env.OPENAI_API_KEY;
if (!KEY) {
  console.error('OPENAI_API_KEY is not set');
  process.exit(1);
}

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'assets');
await mkdir(OUT, { recursive: true });

const STYLE =
  'painterly flat-shaded illustration, clean simple shapes, soft warm golden-hour light, ' +
  'Studio Ghibli inspired, low-poly aesthetic, warm 1970s travel poster palette';

const JOBS = [
  {
    file: 'flower_poppy.png', size: '1024x1024', quality: 'medium', background: 'transparent',
    prompt: `Single stylized orange-red cosmos flower seen from the side, thin green stem, two small leaves, ${STYLE}, game sprite asset, centered, isolated on transparent background, no ground, no cast shadow, no text`,
  },
  {
    file: 'flower_daisy.png', size: '1024x1024', quality: 'medium', background: 'transparent',
    prompt: `Single stylized cream-white daisy wildflower seen from the side, warm yellow center, thin green stem, one small leaf, ${STYLE}, game sprite asset, centered, isolated on transparent background, no ground, no cast shadow, no text`,
  },
  {
    file: 'flower_gold.png', size: '1024x1024', quality: 'medium', background: 'transparent',
    prompt: `Small cluster of stylized golden-yellow wildflowers on thin stems, three blooms, ${STYLE}, game sprite asset, centered, isolated on transparent background, no ground, no cast shadow, no text`,
  },
  {
    file: 'cloud.png', size: '1024x1024', quality: 'medium', background: 'transparent',
    prompt: `Single soft puffy stylized cloud, cream and peach sunset tint, ${STYLE}, game sprite asset, centered, isolated on transparent background, no text`,
  },
  {
    file: 'emblem.png', size: '1024x1024', quality: 'high', background: 'transparent',
    prompt: `Circular retro 1970s travel poster badge: a long empty road through endless flower fields leading to a huge warm setting sun on the horizon, layered low-poly hills, miniature diorama feeling, ${STYLE}, subtle film grain, absolutely no text, no letters, no words, transparent background outside the circle`,
  },
];

async function generate(job, model) {
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt: job.prompt,
      size: job.size,
      quality: job.quality,
      background: job.background,
      output_format: 'png',
      n: 1,
    }),
  });
  if (!res.ok) {
    const text = (await res.text()).slice(0, 300).replace(/\s+/g, ' ');
    throw new Error(`${model} -> HTTP ${res.status}: ${text}`);
  }
  const json = await res.json();
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) throw new Error(`${model} -> no b64_json in response`);
  await writeFile(path.join(OUT, job.file), Buffer.from(b64, 'base64'));
  console.log(`saved ${job.file} (${model})`);
}

let model = process.env.IMAGE_MODEL || 'gpt-image-2';
let failures = 0;

for (const job of JOBS) {
  try {
    await generate(job, model);
  } catch (e) {
    console.warn(String(e.message));
    if (model !== 'gpt-image-1') {
      model = 'gpt-image-1'; // older deployments may not have gpt-image-2 yet
      try {
        await generate(job, model);
        continue;
      } catch (e2) {
        console.error(`FAILED ${job.file}: ${e2.message}`);
        failures++;
      }
    } else {
      console.error(`FAILED ${job.file}: ${e.message}`);
      failures++;
    }
  }
}

console.log(failures === 0 ? 'all assets generated' : `${failures} asset(s) failed`);
process.exit(failures === 0 ? 0 : 2);
