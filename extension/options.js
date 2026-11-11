const $ = (id) => document.getElementById(id);

chrome.storage.local.get(["apiUrl", "apiKey"]).then(({ apiUrl, apiKey }) => {
  $("apiUrl").value = apiUrl || "https://contacts.autobirds.com";
  $("apiKey").value = apiKey || "";
  test();
});

async function test() {
  $("status").textContent = "Checking…";
  $("status").className = "";
  const r = await chrome.runtime.sendMessage({ type: "status" });
  const s = r?.data;
  if (s?.ok) {
    $("status").textContent = `Connected: ${s.count} contacts.`;
    $("status").className = "ok";
  } else {
    $("status").textContent = s?.error || r?.error || "Could not reach the contacts service.";
    $("status").className = "bad";
  }
}

$("save").onclick = async () => {
  const apiUrl = $("apiUrl").value.trim().replace(/\/+$/, "");
  if (!/^https:\/\//.test(apiUrl)) {
    $("status").textContent = "The address must start with https://";
    $("status").className = "bad";
    return;
  }
  await chrome.storage.local.set({ apiUrl, apiKey: $("apiKey").value.trim() });
  test();
};

chrome.storage.local.get(["anthropicKey", "aboutMe"]).then(({ anthropicKey, aboutMe }) => {
  $("anthropicKey").value = anthropicKey || "";
  $("aboutMe").value = aboutMe || "";
});

$("saveDraft").onclick = async () => {
  await chrome.storage.local.set({ anthropicKey: $("anthropicKey").value.trim(), aboutMe: $("aboutMe").value.trim() });
  $("draftStatus").textContent = $("anthropicKey").value.trim() ? "Saved. Drafting is on." : "Saved. Drafting is off (no key).";
  $("draftStatus").className = "ok";
};
