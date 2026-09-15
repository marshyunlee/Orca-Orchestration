import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NodePanel } from "../src/components/NodePanel";
import { GatePanel } from "../src/components/GatePanel";

Object.assign(globalThis, { React });

test("node details show observed identity without offering model or harness controls", () => {
  const html = renderToStaticMarkup(<NodePanel node={{ id: "task_1", label: "Implement", status: "dispatched", spec: "Accepted contract", result: "Evidence", createdAt: "", completedAt: null, dispatchId: "dispatch_observed", assigneeHandle: "term_observed" }} onClose={() => {}} />);
  assert.match(html, /dispatch_observed/);
  assert.match(html, /term_observed/);
  assert.match(html, /Accepted contract/);
  assert.match(html, /Evidence/);
  assert.doesNotMatch(html, /<input|<select|role="combobox"|Default \(claude\)/);
});
test("gates expose native decisions without mutation controls", () => {
  const html = renderToStaticMarkup(<GatePanel gates={[
    { id: "pending", taskId: "task_1", question: "Release?", options: ["accept", "reject"], status: "pending", resolution: null },
    { id: "resolved", taskId: "task_2", question: "Which interface?", options: ["v2"], status: "resolved", resolution: "v2" },
  ]} />);
  assert.match(html, /Release\?/);
  assert.match(html, /Which interface\?/);
  assert.match(html, /v2/);
  assert.doesNotMatch(html, /<button|<input|<select/);
});
