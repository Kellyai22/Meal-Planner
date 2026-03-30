export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const apifyToken = process.env.APIFY_API_TOKEN;
  if (!apifyToken) return res.status(500).json({ error: 'Apify token not configured' });

  const { runId, datasetId } = req.query;
  if (!runId) return res.status(400).json({ error: 'runId required' });

  try {
    // Check run status
    const statusRes = await fetch(
      `https://api.apify.com/v2/actor-runs/${runId}?token=${apifyToken}`
    );
    const statusData = await statusRes.json();
    const status = statusData.data?.status;

    if (status === 'RUNNING' || status === 'READY') {
      return res.status(200).json({ status: 'running' });
    }

    if (status !== 'SUCCEEDED') {
      return res.status(200).json({ status: 'failed', error: `Run ended with status: ${status}` });
    }

    // Run succeeded — fetch dataset items
    const dsId = datasetId || statusData.data?.defaultDatasetId;
    if (!dsId) throw new Error('No dataset ID');

    const itemsRes = await fetch(
      `https://api.apify.com/v2/datasets/${dsId}/items?format=json&limit=5&token=${apifyToken}`
    );
    const items = await itemsRes.json();
    if (!Array.isArray(items) || !items.length) {
      return res.status(200).json({ status: 'failed', error: 'No results found' });
    }

    // Extract text from all items, combine the best fields
    let recipeText = '';
    for (const item of items) {
      if (item.text) recipeText += item.text + '\n\n';
      if (item.caption) recipeText += item.caption + '\n\n';
      if (item.description) recipeText += item.description + '\n\n';
      if (item.message?.text) recipeText += item.message.text + '\n\n';

      // Facebook video captions/transcript
      const captionsUrl = item.short_form_video_context?.playback_video?.captions_url;
      if (captionsUrl) {
        try {
          const srtRes = await fetch(captionsUrl);
          const srt = await srtRes.text();
          const clean = srt
            .replace(/^\d+$/gm, '')
            .replace(/\d{2}:\d{2}:\d{2}[.,]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[.,]\d{3}/g, '')
            .replace(/\n{2,}/g, ' ')
            .trim();
          if (clean) recipeText += 'Video transcript: ' + clean + '\n\n';
        } catch {}
      }

      // TikTok subtitles/transcript
      if (item.videoMeta?.subtitleLinks?.length) {
        for (const sub of item.videoMeta.subtitleLinks) {
          if (sub.downloadLink) {
            try {
              const subRes = await fetch(sub.downloadLink);
              const subText = await subRes.text();
              const clean = subText
                .replace(/^\d+$/gm, '')
                .replace(/\d{2}:\d{2}:\d{2}[.,]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[.,]\d{3}/g, '')
                .replace(/\n{2,}/g, ' ')
                .trim();
              if (clean) recipeText += 'Video transcript: ' + clean + '\n\n';
            } catch {}
          }
        }
      }
      if (item.videoMeta?.transcriptionLink) {
        try {
          const tRes = await fetch(item.videoMeta.transcriptionLink);
          const tText = await tRes.text();
          if (tText) recipeText += 'Video transcript: ' + tText + '\n\n';
        } catch {}
      }
    }

    recipeText = recipeText.trim();
    if (!recipeText) {
      return res.status(200).json({ status: 'failed', error: 'Could not extract text from post' });
    }

    return res.status(200).json({ status: 'done', recipeText });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
