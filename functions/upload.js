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

    const buffer = Buffer.from(base64, 'base64');

    // Resize to exact 1080×1920 Snapchat story size
    let processed = await sharp(buffer)
        .resize({
            width: 1080,
            height: 1920,
            fit: 'cover',
            position: 'center'
        })
        .toBuffer();

    // Bigger, cleaner watermark (now properly visible)
    const watermarkSVG = `
<svg width="1080" height="1920" xmlns="http://www.w3.org/2000/svg">
    <rect x="0" y="1720" width="1080" height="200" fill="#111111" opacity="0.95"/>
    <text x="70" y="1800" font-family="sans-serif" font-size="110" fill="#fffc00">📸</text>
    <text x="220" y="1795" font-family="Arial Black, sans-serif" font-size="78" fill="#fffc00" font-weight="900" letter-spacing="-2">StoryQueue</text>
    <text x="220" y="1870" font-family="Arial, sans-serif" font-size="42" fill="#ffffff">storyqueue.netlify.app</text>
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

    // Timestamp in Denmark (Europe/Copenhagen)
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Copenhagen',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        day: '2-digit', month: '2-digit', year: '2-digit',
        hour12: false
    });
    const parts = formatter.formatToParts(now);
    const h = parts.find(p => p.type === 'hour').value;
    const m = parts.find(p => p.type === 'minute').value;
    const s = parts.find(p => p.type === 'second').value;
    const d = parts.find(p => p.type === 'day').value;
    const mo = parts.find(p => p.type === 'month').value;
    const y = parts.find(p => p.type === 'year').value.slice(-2);
    const timestamp = `${h}${m}${s}${d}${mo}${y}`;

    const filename = `${nextNum}_${timestamp}.jpg`;

    const uploadRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/storyqueue/${filename}`, {
        method: "PUT",
        headers: {
            Authorization: `token ${TOKEN}`,
            "Content-Type": "application/json",
            Accept: "application/vnd.github.v3+json"
        },
        body: JSON.stringify({
            message: `📸 Photo upload: ${filename}`,
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
