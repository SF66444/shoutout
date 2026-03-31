exports.handler = async (event) => {
    if (event.httpMethod !== "POST") {
        return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
    }

    const { base64, mimeType } = JSON.parse(event.body);

    // Basic server-side validation (same as frontend)
    if (!["image/png", "image/jpeg"].includes(mimeType)) {
        return { statusCode: 400, body: JSON.stringify({ error: "Only PNG, JPG and JPEG allowed" }) };
    }

    const OWNER = process.env.GITHUB_OWNER;
    const REPO = process.env.GITHUB_REPO;
    const TOKEN = process.env.GITHUB_TOKEN;

    if (!OWNER || !REPO || !TOKEN) {
        return { statusCode: 500, body: JSON.stringify({ error: "Server configuration missing" }) };
    }

    // Get next number (or 1 if folder doesn't exist yet)
    let nextNum = 1;
    try {
        const listRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/storyqueue`, {
            headers: {
                Authorization: `token ${TOKEN}`,
                Accept: "application/vnd.github.v3+json"
            }
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
        // if 404 → folder doesn't exist yet → nextNum stays 1
    } catch (e) {
        // folder doesn't exist yet → start at 1
    }

    // Generate timestamp HHMMSSDDMMYY
    const now = new Date();
    const pad = n => n.toString().padStart(2, "0");
    const timestamp = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}${pad(now.getDate())}${pad(now.getMonth() + 1)}${now.getFullYear().toString().slice(2)}`;

    const ext = mimeType === "image/png" ? "png" : "jpg";
    const filename = `${nextNum}_${timestamp}.${ext}`;

    // Upload to GitHub
    const uploadRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/storyqueue/${filename}`, {
        method: "PUT",
        headers: {
            Authorization: `token ${TOKEN}`,
            "Content-Type": "application/json",
            Accept: "application/vnd.github.v3+json"
        },
        body: JSON.stringify({
            message: `📸 Public upload: ${filename}`,
            content: base64,
            branch: "main"
        })
    });

    if (!uploadRes.ok) {
        const err = await uploadRes.json();
        return { statusCode: 500, body: JSON.stringify({ error: err.message || "GitHub upload failed" }) };
    }

    return {
        statusCode: 200,
        body: JSON.stringify({ filename })
    };
};
