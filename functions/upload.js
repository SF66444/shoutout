const sharp = require('sharp');

exports.handler = async (event) => {
    if (event.httpMethod !== "POST") {
        return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
    }

    const { base64, mimeType } = JSON.parse(event.body);

    if (!["image/png", "image/jpeg"].includes(mimeType)) {
        return { statusCode: 400, body: JSON.stringify({ error: "Only PNG, JPG and JPEG allowed" }) };
    }

    const OWNER = process.env.GITHUB_OWNER;
    const REPO = process.env.GITHUB_REPO;
    const TOKEN = process.env.GITHUB_TOKEN;

    if (!OWNER || !REPO || !TOKEN) {
        return { statusCode: 500, body: JSON.stringify({ error: "Server configuration missing" }) };
    }

    // Decode base64
    const buffer = Buffer.from(base64, 'base64');

    // 1. Resize to exact Snapchat story size 1080×1920 (cover = crop to fill)
    let processed = await sharp(buffer)
        .resize({
            width: 1080,
            height: 1920,
            fit: 'cover',
            position: 'center'
        })
        .toBuffer();

    // 2. Add StoryQueue watermark at the bottom
    const watermarkSVG = `
<svg width="1080" height="1920" xmlns="http://www.w3.org/2000/svg">
    <rect x="0" y="1770" width="1080" height="150" fill="#111111" opacity="0.9"/>
    <text x="80" y="1845" font-family="sans-serif" font-size="90" fill="#fffc00">📸</text>
    <text x="200" y="1835" font-family="Arial Black,sans-serif" font-size="52" fill="#fffc00" font-weight="700">StoryQueue</text>
    <text x="200" y="1890" font-family="Arial,sans-serif" font-size="32" fill="#ffffff">storyqueue.netlify.app</text>
</svg>`;

    const watermarkBuffer = Buffer.from(watermarkSVG);

    const finalImage = await sharp(processed)
        .composite([{ input: watermarkBuffer, top: 0, left: 0 }])
        .jpeg({ quality: 92 })
        .toBuffer();

    // Get next number
    let nextNum = 1;
    try {
        const listRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/storyqueue`, {
            headers: { Authorization: `token ${TOKEN}`, Accept: "application/vnd.github.v3+json" }
        });
        if (listRes.ok) {
            const files = await listRes.json();
            let max = 0;
            files.forEach(file => {
                if (file.type === "file") {
                    const match = file.name.match(/^(\d+)_/);
                    if (match) max = Math.max(max, parseInt(match[1]));
                }
            });
            nextNum = max + 1;
        }
    } catch (e) {}

    // Timestamp in Denmark time (Europe/Copenhagen)
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Copenhagen',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        day: '2-digit',
        month: '2-digit',
        year: '2-digit',
        hour12: false
    });
    const parts = formatter.formatToParts(now);
    const hour = parts.find(p => p.type === 'hour').value;
    const minute = parts.find(p => p.type === 'minute').value;
    const second = parts.find(p => p.type === 'second').value;
    const day = parts.find(p => p.type === 'day').value;
    const month = parts.find(p => p.type === 'month').value;
    const year = parts.find(p => p.type === 'year').value.slice(-2);
    const timestamp = `${hour}${minute}${second}${day}${month}${year}`;

    const filename = `${nextNum}_${timestamp}.jpg`;

    // Upload to GitHub
    const uploadRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/storyqueue/${filename}`, {
        method: "PUT",
        headers: {
            Authorization: `token ${TOKEN}`,
            "Content-Type": "application/json",
            Accept: "application/vnd.github.v3+json"
        },
        body: JSON.stringify({
            message: `📸 Shoutout: ${filename}`,
            content: finalImage.toString('base64'),
            branch: "main"
        })
    });

    if (!uploadRes.ok) {
        const err = await uploadRes.json();
        return { statusCode: 500, body: JSON.stringify({ error: err.message || "GitHub upload failed" }) };
    }

    return { statusCode: 200, body: JSON.stringify({ filename }) };
};
