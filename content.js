(() => {
  console.log("Chat OpenAI content script loaded.");

  const BUTTON_ID = "docgen-floating-button";
  if (document.getElementById(BUTTON_ID)) return;

  const OVERLAY_ID = "docgen-modal-overlay";
  const MODAL_ID = "docgen-modal";
  const TEXTAREA_ID = "docgen-prompt-textarea";

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function renderMarkdownLike(text) {
    const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
    const html = [];
    let inList = false;

    const closeList = () => {
      if (inList) {
        html.push("</ul>");
        inList = false;
      }
    };

    const formatInline = (value) =>
      escapeHtml(value).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) {
        closeList();
        continue;
      }

      const h1Match = line.match(/^#\s+(.+)$/);
      if (h1Match) {
        closeList();
        html.push(`<h1>${formatInline(h1Match[1])}</h1>`);
        continue;
      }

      const h2Match = line.match(/^##\s+(.+)$/);
      if (h2Match) {
        closeList();
        html.push(`<h2>${formatInline(h2Match[1])}</h2>`);
        continue;
      }

      const h3Match = line.match(/^###\s+(.+)$/);
      if (h3Match) {
        closeList();
        html.push(`<h3>${formatInline(h3Match[1])}</h3>`);
        continue;
      }

      const bulletMatch = line.match(/^[-*]\s+(.+)$/);
      if (bulletMatch) {
        if (!inList) {
          html.push("<ul>");
          inList = true;
        }
        html.push(`<li>${formatInline(bulletMatch[1])}</li>`);
        continue;
      }

      closeList();
      html.push(`<p>${formatInline(line)}</p>`);
    }

    closeList();
    return html.join("");
  }

  function scrapeChat() {
    const messages = [];
    const hostname = window.location.hostname;

    const normalizeText = (value) =>
      String(value || "").replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

    const isVisible = (el) => {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
        return false;
      }
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };

    const pushUnique = (role, text, seen) => {
      const normalizedRole = role === "user" ? "user" : "assistant";
      const normalizedText = normalizeText(text);
      if (!normalizedText) return;
      const key = `${normalizedRole}:${normalizedText.slice(0, 300)}`;
      if (seen.has(key)) return;
      seen.add(key);
      messages.push({ role: normalizedRole, text: normalizedText });
    };

    const scrapeKnownSelectors = (selectorList) => {
      const seen = new Set();
      selectorList.forEach((selector) => {
        document.querySelectorAll(selector).forEach((node) => {
          if (!isVisible(node)) return;
          const roleNode =
            node.matches?.("[data-message-author-role]")
              ? node
              : node.closest?.("[data-message-author-role]") || node.querySelector?.("[data-message-author-role]");
          const rawRole = roleNode?.getAttribute?.("data-message-author-role");
          if (rawRole !== "user" && rawRole !== "assistant") return;
          pushUnique(rawRole, node.innerText, seen);
        });
      });
    };

    const fallbackVisibleBlocks = () => {
      const seen = new Set();
      let nextRole = "user";
      const blocks = document.querySelectorAll(
        "main p, main div, main article, [role='main'] p, [role='main'] div, [role='main'] article"
      );
      blocks.forEach((node) => {
        if (!isVisible(node)) return;
        const text = normalizeText(node.innerText);
        if (!text || text.length < 15) return;
        if (node.children.length > 0 && text.length < 40) return;
        pushUnique(nextRole, text, seen);
        nextRole = nextRole === "user" ? "assistant" : "user";
      });
    };

    if (hostname.includes("chatgpt.com") || hostname.includes("chat.openai.com")) {
      scrapeKnownSelectors(["[data-message-author-role]"]);
    } else if (hostname.includes("claude.ai")) {
      const seen = new Set();
      const assistantNodes = Array.from(document.querySelectorAll("div.standard-markdown")).filter(isVisible);
      const findUserTextBefore = (assistantNode) => {
        const assistantContainer =
          assistantNode.closest("article") ||
          assistantNode.closest("[data-testid*='message']") ||
          assistantNode.parentElement;
        let sibling = assistantContainer?.previousElementSibling;
        while (sibling) {
          if (isVisible(sibling)) {
            const text = normalizeText(sibling.innerText);
            const hasAssistantMarkdown = Boolean(sibling.querySelector?.("div.standard-markdown"));
            if (text && !hasAssistantMarkdown) return text;
          }
          sibling = sibling.previousElementSibling;
        }
        return "";
      };

      assistantNodes.forEach((assistantNode) => {
        const userText = findUserTextBefore(assistantNode);
        if (userText) pushUnique("user", userText, seen);
        pushUnique("assistant", assistantNode.innerText, seen);
      });
      if (!messages.length) fallbackVisibleBlocks();
    } else if (hostname.includes("gemini.google.com")) {
      const seen = new Set();
      const geminiNodes = Array.from(
        document.querySelectorAll(".user-query-text, .user-query-content, .markdown-main-panel")
      ).filter(isVisible);
      geminiNodes.forEach((node) => {
        const role = node.matches(".markdown-main-panel") ? "assistant" : "user";
        pushUnique(role, node.innerText, seen);
      });
      if (!messages.length) fallbackVisibleBlocks();
    } else if (hostname.includes("grok.com")) {
      const seen = new Set();
      const grokNodes = Array.from(document.querySelectorAll("div.relative")).filter(
        (node) => isVisible(node) && (node.querySelector(".prose") || node.innerText.includes("Human:"))
      );
      grokNodes.forEach((node) => {
        const proseNode = node.querySelector(".prose");
        const text = normalizeText(proseNode?.innerText || node.innerText);
        if (!text) return;
        const role = text.includes("Human:") || node.matches("[contenteditable='true'], textarea")
          ? "user"
          : "assistant";
        pushUnique(role, text.replace(/^Human:\s*/i, ""), seen);
      });
      if (!messages.length) fallbackVisibleBlocks();
    } else if (hostname.includes("perplexity.ai")) {
      scrapeKnownSelectors([
        "[data-message-author-role]",
        "article",
        "[data-testid*='message']",
      ]);
      if (!messages.length) fallbackVisibleBlocks();
    } else if (hostname.includes("copilot.microsoft.com")) {
      scrapeKnownSelectors([
        "[data-message-author-role]",
        "cib-chat-turn",
        "[data-testid*='message']",
      ]);
      if (!messages.length) fallbackVisibleBlocks();
    } else {
      fallbackVisibleBlocks();
    }

    if (!messages.length) fallbackVisibleBlocks();
    console.log("scrapeChat()", messages);
    return messages;
  }

  function closeModal() {
    const overlay = document.getElementById(OVERLAY_ID);
    if (overlay) overlay.remove();
  }

  function openModal() {
    if (document.getElementById(OVERLAY_ID)) return;

    const overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      background: "rgba(0, 0, 0, 0.6)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: "2147483647",
      padding: "24px",
      boxSizing: "border-box",
    });

    const modal = document.createElement("div");
    modal.id = MODAL_ID;
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    Object.assign(modal.style, {
      position: "relative",
      width: "min(720px, 100%)",
      background: "#ffffff",
      color: "#111111",
      borderRadius: "12px",
      padding: "16px",
      boxShadow: "0 20px 60px rgba(0, 0, 0, 0.35)",
      fontFamily: "Arial, sans-serif",
    });

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.textContent = "✕";
    closeBtn.setAttribute("aria-label", "Close");
    Object.assign(closeBtn.style, {
      position: "absolute",
      top: "10px",
      right: "10px",
      width: "32px",
      height: "32px",
      borderRadius: "8px",
      border: "1px solid #e5e5e5",
      background: "#ffffff",
      cursor: "pointer",
      fontSize: "16px",
      lineHeight: "1",
    });
    closeBtn.addEventListener("click", closeModal);

    const title = document.createElement("div");
    title.textContent = "Generate Doc";
    Object.assign(title.style, {
      fontSize: "16px",
      fontWeight: "700",
      marginBottom: "12px",
      paddingRight: "40px",
    });

    const textarea = document.createElement("textarea");
    textarea.id = TEXTAREA_ID;
    textarea.placeholder = "What do you want to generate? (e.g. structured research notes, resume, study notes)";
    Object.assign(textarea.style, {
      width: "100%",
      minHeight: "140px",
      resize: "vertical",
      padding: "12px",
      borderRadius: "10px",
      border: "1px solid #d0d0d0",
      outline: "none",
      fontSize: "14px",
      lineHeight: "1.4",
      boxSizing: "border-box",
    });

    const status = document.createElement("div");
    Object.assign(status.style, {
      marginTop: "12px",
      fontSize: "13px",
      color: "#444",
      display: "none",
      whiteSpace: "pre-wrap",
      wordBreak: "break-word",
    });

    const output = document.createElement("div");
    Object.assign(output.style, {
      marginTop: "12px",
      padding: "12px",
      borderRadius: "10px",
      border: "1px solid #e5e5e5",
      background: "#fafafa",
      maxHeight: "45vh",
      overflow: "auto",
      fontSize: "13px",
      lineHeight: "1.4",
      whiteSpace: "normal",
      wordBreak: "break-word",
      display: "none",
    });

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.textContent = "Copy to Clipboard";
    copyBtn.disabled = true;
    Object.assign(copyBtn.style, {
      marginTop: "10px",
      padding: "8px 12px",
      borderRadius: "8px",
      border: "1px solid #d0d0d0",
      background: "#ffffff",
      color: "#111111",
      cursor: "not-allowed",
      fontSize: "13px",
      display: "none",
    });

    const downloadPdfBtn = document.createElement("button");
    downloadPdfBtn.type = "button";
    downloadPdfBtn.textContent = "Download PDF";
    Object.assign(downloadPdfBtn.style, {
      padding: "10px 14px",
      borderRadius: "10px",
      border: "none",
      background: "#1a1a1a",
      color: "#ffffff",
      cursor: "pointer",
      fontSize: "14px",
      lineHeight: "1",
    });

    const responseActions = document.createElement("div");
    Object.assign(responseActions.style, {
      marginTop: "10px",
      display: "none",
      gap: "10px",
      alignItems: "center",
    });
    responseActions.appendChild(copyBtn);
    responseActions.appendChild(downloadPdfBtn);

    const footer = document.createElement("div");
    Object.assign(footer.style, {
      display: "flex",
      justifyContent: "flex-end",
      gap: "10px",
      marginTop: "12px",
    });

    const generateBtn = document.createElement("button");
    generateBtn.type = "button";
    generateBtn.textContent = "Generate";
    Object.assign(generateBtn.style, {
      padding: "10px 14px",
      borderRadius: "10px",
      border: "none",
      background: "#1a1a1a",
      color: "#ffffff",
      cursor: "pointer",
      fontSize: "14px",
      lineHeight: "1",
    });
    let latestResponseText = "";

    copyBtn.addEventListener("click", async () => {
      if (!latestResponseText) return;
      try {
        await navigator.clipboard.writeText(latestResponseText);
        copyBtn.textContent = "Copied!";
        setTimeout(() => {
          copyBtn.textContent = "Copy to Clipboard";
        }, 1400);
      } catch {
        copyBtn.textContent = "Copy failed";
        setTimeout(() => {
          copyBtn.textContent = "Copy to Clipboard";
        }, 1400);
      }
    });

    downloadPdfBtn.addEventListener("click", async () => {
      if (!latestResponseText) return;
      try {
        const JsPDF = window.jspdf?.jsPDF;
        if (!JsPDF) throw new Error("jsPDF unavailable");
        const doc = new JsPDF({ unit: "mm", format: "a4" });
        const margin = 25;
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        const maxTextWidth = pageWidth - margin * 2;
        let y = margin;
        const rawLines = String(latestResponseText || "").replace(/\r\n/g, "\n").split("\n");

        const ensureSpace = (neededHeight) => {
          if (y + neededHeight > pageHeight - margin) {
            doc.addPage();
            y = margin;
          }
        };

        const drawBlock = (text, size, fontStyle = "normal", spacingBefore = 0, spacingAfter = 1, align = "left", underline = false) => {
          const clean = String(text || "").replace(/\*\*(.*?)\*\*/g, "$1").trim();
          if (!clean) {
            y += 2;
            return;
          }
          y += spacingBefore;
          doc.setFont("helvetica", fontStyle);
          doc.setFontSize(size);
          const wrapped = doc.splitTextToSize(clean, maxTextWidth);
          const lineHeight = size * 0.529;
          ensureSpace(wrapped.length * lineHeight + spacingAfter + (underline ? 3 : 0));
          doc.text(wrapped, align === "center" ? pageWidth / 2 : margin, y, { align });
          y += wrapped.length * lineHeight;
          if (underline) {
            y += 3;
            doc.setLineWidth(0.2);
            doc.line(margin, y, pageWidth - margin, y);
          }
          y += spacingAfter;
        };

        const drawCodeBlock = (codeLines) => {
          const lines = codeLines.length ? codeLines : [" "];
          const lineHeight = 5;
          const blockHeight = lines.length * lineHeight + 4;
          y += 2;
          ensureSpace(blockHeight);
          doc.setFont("courier", "normal");
          doc.setFontSize(9);
          doc.setFillColor(245, 245, 245);
          doc.rect(margin - 2, y - 4, maxTextWidth + 4, blockHeight, "F");
          lines.forEach((codeLine) => {
            doc.text(String(codeLine || " "), margin, y);
            y += lineHeight;
          });
          y += 3;
          doc.setFont("helvetica", "normal");
        };

        let inCodeBlock = false;
        let codeBlockLines = [];
        let titleDrawn = false;
        for (const rawLine of rawLines) {
          const line = rawLine.trim();
          if (line.startsWith("```")) {
            if (inCodeBlock) {
              drawCodeBlock(codeBlockLines);
              codeBlockLines = [];
            }
            inCodeBlock = !inCodeBlock;
            continue;
          }
          if (inCodeBlock) {
            codeBlockLines.push(rawLine);
            continue;
          }
          if (!line) {
            y += 2;
            continue;
          }
          const normalizedLine = line.replace(/\*\*(.*?)\*\*/g, "$1");
          if (normalizedLine.startsWith("### ")) {
            drawBlock(normalizedLine.slice(4), 13, "bold", 6, 3);
          } else if (normalizedLine.startsWith("## ")) {
            drawBlock(normalizedLine.slice(3), 16, "bold", 8, 4);
          } else if (normalizedLine.startsWith("# ")) {
            drawBlock(normalizedLine.slice(2), 22, "bold", titleDrawn ? 8 : 0, 10, "center", !titleDrawn);
            titleDrawn = true;
          } else if (normalizedLine.startsWith("- ")) {
            drawBlock(`• ${normalizedLine.slice(2)}`, 11, "normal", 1, 2);
          } else {
            drawBlock(normalizedLine, 11, "normal", 1, 2);
          }
        }
        if (inCodeBlock) drawCodeBlock(codeBlockLines);

        const pageCount = doc.internal.getNumberOfPages();
        for (let page = 1; page <= pageCount; page += 1) {
          doc.setPage(page);
          doc.setFont("helvetica", "normal");
          doc.setFontSize(9);
          doc.text(`Page ${page} of ${pageCount}`, pageWidth / 2, pageHeight - 10, { align: "center" });
        }

        doc.save("document.pdf");
      } catch (e) {
        status.style.display = "block";
        status.textContent = `Error: ${e?.message || String(e)}`;
      }
    });

    generateBtn.addEventListener("click", async () => {
      const userPrompt = String(textarea.value ?? "").trim();
      const messages = scrapeChat();
      const MAX_CHAT_CHARS = 100000;
      const totalMessageChars = messages.reduce(
        (total, message) => total + String(message?.text || "").length,
        0
      );
      const messagesWereTrimmed = totalMessageChars > MAX_CHAT_CHARS;
      let limitedMessages = messages;
      if (messagesWereTrimmed) {
        let runningChars = 0;
        limitedMessages = [];
        for (const message of messages) {
          const messageLength = String(message?.text || "").length;
          if (runningChars + messageLength > MAX_CHAT_CHARS) break;
          runningChars += messageLength;
          limitedMessages.push(message);
        }
      }

      output.style.display = "none";
      output.innerHTML = "";
      responseActions.style.display = "none";
      copyBtn.disabled = true;
      copyBtn.style.cursor = "not-allowed";
      latestResponseText = "";
      status.style.display = "block";
      status.textContent = messagesWereTrimmed
        ? "Generating...\nLong conversation detected — processing from the beginning"
        : "Generating...";

      generateBtn.disabled = true;
      generateBtn.style.opacity = "0.7";
      generateBtn.style.cursor = "not-allowed";

      try {
        const CHUNK_SIZE = 50;
        const messageChunks = [];
        for (let i = 0; i < limitedMessages.length; i += CHUNK_SIZE) {
          messageChunks.push(limitedMessages.slice(i, i + CHUNK_SIZE));
        }
        const chunkResponses = [];

        for (let chunkIndex = 0; chunkIndex < messageChunks.length; chunkIndex += 1) {
          status.textContent = `Processing chunk ${chunkIndex + 1} of ${messageChunks.length}...`;
          const chunk = messageChunks[chunkIndex];
          const res = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${CONFIG.OPENAI_API_KEY}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            max_tokens: 4000,
            messages: [
              {
                role: "system",
                content: "You are a professional document formatter. Your job is to transform AI chat conversations into clean, well-structured documents that look human-made.\n\nCORE RULES:\n- Follow the user's requested format exactly\n- Remove ALL AI filler phrases, closing remarks, transitional summaries, and meta-commentary\n- Never add placeholder text in brackets\n- End immediately after the last content point\n- Never mention that this was generated from a chat\n- Never add Practice Recommendations, Next Steps, or any motivational advice sections\n- Never add concluding sentences summarizing the document\n- Preserve all code snippets exactly as they appear in the conversation, wrapped in code blocks\n\nFORMAT INTELLIGENCE:\nWhen the user requests a report, essay, abstract, introduction, problem statement, motivation, conclusion, or any narrative section — write in flowing prose paragraphs. Never use bullet points in narrative sections unless the user explicitly asks.\nWhen the user requests Q&A, interview prep, or FAQs — write questions in bold, answers in clean prose paragraphs beneath each question.\nWhen the user requests notes, summaries, or lists — use clean bullet points with consistent structure.\nWhen the user requests methodology, steps, or processes — use numbered steps, not bullets.\nWhen the user requests sensors, components, tools, or technical specifications — use a clean two column structure: Item — Description.\n\nDOCUMENT STRUCTURE:\nAlways begin with a title that matches what the user requested.\nUse clear section headers that are descriptive and specific to the content.\nNever use generic headers like Section 1 or Content.\n\nQUALITY STANDARD:\nEvery sentence must sound like a human professional wrote it.\nNo sentence should sound like it was pulled directly from a chatbot response.\n\nSTRICT PROHIBITIONS:\nNever start any section with In conclusion, To summarize, In this document, This document covers, As an AI, I hope this helps, Feel free to, or any similar phrase.\nNever end the document with a summary of what was just written.\nNever use bullet points in abstract, introduction, problem statement, motivation, or conclusion sections.\nNever mix bullet points and prose randomly.\nNever write placeholder text like 'insert actual code here', 'code not provided', 'insert appropriate code', 'please insert', or any similar placeholder.\nIf code is not available in the conversation, skip that section entirely. Never acknowledge missing content.\nNever write meta-commentary about the document itself.\nNever mention limitations of the notes or conversation.\nNever reference the PDF, document generation, or tool."
              },
              {
                role: "user",
                content: "This is part " + (chunkIndex + 1) + " of " + messageChunks.length + " chunks from one conversation. Avoid repeating topics already covered in previous sections. Each section should cover unique content only. Here is the chat: " + JSON.stringify(chunk) + ". The user wants notes in this format: " + userPrompt
              }
            ]
          }),
        });

        const data = await res.json().catch(() => null);
        if (!res.ok) {
          const errText =
            (data && (data.error?.message || data.message)) ||
            `Request failed with status ${res.status}`;
          throw new Error(errText);
        }

        const text =
          data?.choices?.[0]?.message?.content ??
          data?.content
            ?.filter((c) => c && c.type === "text")
            ?.map((c) => c.text)
            ?.join("\n") ??
          data?.content?.[0]?.text ??
          "";

          chunkResponses.push(text);
        }

        status.style.display = "none";
        output.style.display = "block";
        latestResponseText = chunkResponses.filter(Boolean).join("\n\n") || "(No text content returned.)";
        output.innerHTML = renderMarkdownLike(latestResponseText);
        responseActions.style.display = "flex";
        copyBtn.disabled = false;
        copyBtn.style.cursor = "pointer";
      } catch (e) {
        status.style.display = "block";
        status.textContent = `Error: ${e?.message || String(e)}`;
      } finally {
        generateBtn.disabled = false;
        generateBtn.style.opacity = "1";
        generateBtn.style.cursor = "pointer";
      }
    });

    footer.appendChild(generateBtn);
    modal.appendChild(closeBtn);
    modal.appendChild(title);
    modal.appendChild(textarea);
    modal.appendChild(status);
    modal.appendChild(output);
    modal.appendChild(responseActions);
    modal.appendChild(footer);
    overlay.appendChild(modal);

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeModal();
    });

    const onKeyDown = (e) => {
      if (e.key === "Escape") closeModal();
    };

    overlay.addEventListener("keydown", onKeyDown);
    document.addEventListener("keydown", onKeyDown, { once: true });

    document.documentElement.appendChild(overlay);
    textarea.focus();
  }

  const btn = document.createElement("button");
  btn.id = BUTTON_ID;
  btn.type = "button";
  btn.textContent = "📄 Generate Doc";

  Object.assign(btn.style, {
    position: "fixed",
    right: "20px",
    bottom: "20px",
    padding: "12px 20px",
    borderRadius: "8px",
    background: "#1a1a1a",
    color: "#ffffff",
    border: "none",
    cursor: "pointer",
    zIndex: "2147483647",
    fontSize: "14px",
    lineHeight: "1",
  });

  btn.addEventListener("click", () => {
    console.log("button clicked");
    openModal();
  });

  document.documentElement.appendChild(btn);
})();
