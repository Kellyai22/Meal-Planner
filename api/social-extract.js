export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apifyToken = process.env.APIFY_API_TOKEN;
  if (!apifyToken) return res.status(500).json({ error: 'Apify token not configured' });

  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });

  try {
    const lUrl = url.toLowerCase();
    let actorId = 'apify~facebook-posts-scraper';
    let input = { startUrls: [{ url }], resultsLimit: 1, captionText: true };

    if (lUrl.includes('instagram.com') || lUrl.includes('instagr.am')) {
      actorId = 'apify~instagram-post-scraper';
      input = { directUrls: [url], resultsLimit: 1 };
    } else if (lUrl.includes('tiktok.com') || lUrl.includes('vm.tiktok')) {
      actorId = 'clockworks~free-tiktok-scraper';
      input = { postURLs: [url], shouldDownloadCovers: false, shouldDownloadVideos: false };
    }

    // Run the Apify actor and wait for results
    const runRes = await fetch(
      `https://api.apify.com/v2/acts/${actorId}/runs?waitForFinish=120&token=${apifyToken}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }
    );

    if (!runRes.ok) throw new Error('Apify run failed');
    const runData = await runRes.json();
    const dsId = runData.data?.defaultDatasetId;
    if (!dsId) throw new Error('No dataset returned');

    // Fetch the results
    const itemsRes = await fetch(
      `https://api.apify.com/v2/datasets/${dsId}/items?format=json&limit=1&token=${apifyToken}`
    );
    const items = await itemsRes.json();
    const item = Array.isArray(items) ? items[0] : items;
    if (!item) throw new Error('No results found');

    // Extract text from various fields
    let recipeText = '';
    if (item.message?.text) recipeText += item.message.text + '\n\n';
    if (item.text) recipeText += item.text + '\n\n';
    if (item.caption) recipeText += item.caption + '\n\n';
    if (item.description) recipeText += item.description + '\n\n';

    // Try to fetch video transcript (SRT captions)
    const captionsUrl = item.short_form_video_context?.playback_video?.captions_url;
    if (captionsUrl) {
      try {
        const srtRes = await fetch(captionsUrl);
        const srt = await srtRes.text();
        const clean = srt
          .replace(/^\d+$/gm, '')
          .replace(/\d{2}:\d{2}:\d{2},\d{3}\s*-->\s*\d{2}:\d{2}:\d{2},\d{3}/g, '')
          .replace(/\n{2,}/g, ' ')
          .trim();
        if (clean) recipeText += 'Video transcript: ' + clean;
      } catch {}
    }

    return res.status(200).json({ recipeText: recipeText.trim() });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
