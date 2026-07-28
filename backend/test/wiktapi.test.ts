import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mapWiktApiDefinitionsPayload,
  mapWiktApiPronunciationPayload,
  WiktApiProvider,
} from "../src/providers/wiktapi.js";
import { WordProviderError } from "../src/words/types.js";

function asFetch(
  implementation: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>,
): typeof fetch {
  return implementation as typeof fetch;
}

function definitionsPayload(): {
  word: string;
  edition: string;
  definitions: Array<Record<string, unknown>>;
} {
  return {
    word: "Serendipity",
    edition: "en",
    definitions: [
      {
        pos: "noun",
        glosses: [" An unsought, unintended, and unexpected discovery. "],
        examples: [{ text: "The discovery was pure serendipity." }],
      },
      {
        pos: "noun",
        senses: [{ glosses: ["A combination of events which are not individually beneficial."] }],
      },
    ],
  };
}

function fullEntryPayload(): Record<string, unknown> {
  return {
    word: "serendipity",
    edition: "en",
    entries: [
      {
        sounds: [
          {
            ipa: "ˌsɛɹənˈdɪpɪti",
            mp3_url: "https://audio.example/us.mp3",
            tags: ["US"],
          },
          {
            ipa: "/ˌsɛɹənˈdɪpɪti/",
            mp3_url: "https://audio.example/en-gb/serendipity.mp3",
          },
        ],
      },
    ],
  };
}

function pendingUntilAbort(init?: RequestInit): Promise<Response> {
  return new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
      once: true,
    });
  });
}

test("definitions are authoritative for meanings and full entry supplies pronunciation", () => {
  const entry = mapWiktApiDefinitionsPayload(definitionsPayload());
  const pronunciation = mapWiktApiPronunciationPayload(fullEntryPayload());

  assert.deepEqual(entry, {
    word: "serendipity",
    phonetic: "",
    meanings: [
      {
        pos: "noun",
        definition: "An unsought, unintended, and unexpected discovery.",
        example: "The discovery was pure serendipity.",
        sourceId: "wiktapi",
      },
      {
        pos: "noun",
        definition: "A combination of events which are not individually beneficial.",
        example: undefined,
        sourceId: "wiktapi",
      },
    ],
    source: "backend",
  });
  assert.equal(entry?.meanings.some((meaning) => meaning.pos === "unknown"), false);
  assert.deepEqual(pronunciation, {
    phonetic: "/ˌsɛɹənˈdɪpɪti/",
    audioUrl: "https://audio.example/en-gb/serendipity.mp3",
  });
  assert.deepEqual(mapWiktApiPronunciationPayload(fullEntryPayload(), "us"), {
    phonetic: "/ˌsɛɹənˈdɪpɪti/",
    audioUrl: "https://audio.example/us.mp3",
  });
});

test("definitions mapping enforces a global maximum of eight meanings", () => {
  const payload = definitionsPayload();
  payload.definitions = [
    {
      pos: "noun",
      glosses: Array.from({ length: 8 }, (_, index) => `First ${index}`),
    },
    {
      pos: "verb",
      glosses: ["Must not be appended"],
      senses: [{ glosses: ["Nor may this sense be appended"] }],
    },
  ];

  const entry = mapWiktApiDefinitionsPayload(payload);
  assert.equal(entry?.meanings.length, 8);
  assert.equal(entry?.meanings[7]?.definition, "First 7");
  assert.equal(entry?.meanings.some((meaning) => meaning.pos === "verb"), false);
});

test("definitions mapping preserves multiple parts of speech and filters empty glosses", () => {
  assert.deepEqual(
    mapWiktApiDefinitionsPayload({
      word: "test",
      definitions: [
        { pos: "noun", glosses: ["", "A noun definition."] },
        {
          pos: "verb",
          senses: [
            {
              glosses: ["  ", "A verb definition."],
              examples: [{ text: "They test the result." }],
            },
          ],
        },
      ],
    })?.meanings,
    [
      { pos: "noun", definition: "A noun definition.", example: undefined, sourceId: "wiktapi" },
      {
        pos: "verb",
        definition: "A verb definition.",
        example: "They test the result.",
        sourceId: "wiktapi",
      },
    ],
  );

  assert.equal(
    mapWiktApiDefinitionsPayload({
      word: "empty",
      definitions: [{ pos: "noun", glosses: ["  "] }],
    }),
    null,
  );
});

test("definitions mapping requires a valid part of speech", () => {
  assert.throws(
    () =>
      mapWiktApiDefinitionsPayload({
        word: "test",
        definitions: [{ glosses: ["A gloss without pos."] }],
      }),
    (error: unknown) =>
      error instanceof WordProviderError && error.code === "UPSTREAM_PARSE_ERROR",
  );
});

test("pronunciation mapping normalizes IPA and omits non-HTTPS audio", () => {
  assert.deepEqual(
    mapWiktApiPronunciationPayload({
      entries: [
        {
          sounds: [{ ipa: "[test]", mp3_url: "http://audio.example/test.mp3" }],
        },
      ],
    }),
    { phonetic: "/test/" },
  );
});

test("WiktApiProvider requests definitions and full entry in parallel with lang=en", async () => {
  const requestedUrls: string[] = [];
  const signals: AbortSignal[] = [];
  const provider = new WiktApiProvider({
    baseUrl: "https://wikt.example/v1/en/word/",
    fetchFn: asFetch(async (input, init) => {
      const url = String(input);
      requestedUrls.push(url);
      if (init?.signal) {
        signals.push(init.signal);
      }
      return Response.json(url.includes("/definitions?") ? definitionsPayload() : fullEntryPayload());
    }),
  });

  const entry = await provider.lookup("  SERENDIPITY ");
  assert.deepEqual(entry, {
    word: "serendipity",
    phonetic: "/ˌsɛɹənˈdɪpɪti/",
    audioUrl: "https://audio.example/en-gb/serendipity.mp3",
    meanings: [
      {
        pos: "noun",
        definition: "An unsought, unintended, and unexpected discovery.",
        example: "The discovery was pure serendipity.",
        sourceId: "wiktapi",
      },
      {
        pos: "noun",
        definition: "A combination of events which are not individually beneficial.",
        example: undefined,
        sourceId: "wiktapi",
      },
    ],
    source: "backend",
  });
  assert.deepEqual(requestedUrls.sort(), [
    "https://wikt.example/v1/en/word/serendipity/definitions?lang=en",
    "https://wikt.example/v1/en/word/serendipity?lang=en",
  ]);
  assert.equal(signals.length, 2);
  assert.equal(signals[0], signals[1]);
});

test("required definitions failures retain stable provider error classes", async (context) => {
  await context.test("404 is not found", async () => {
    const provider = new WiktApiProvider({
      fetchFn: asFetch(async (input) =>
        String(input).includes("/definitions?")
          ? new Response(null, { status: 404 })
          : Response.json(fullEntryPayload()),
      ),
    });
    assert.equal(await provider.lookup("missing"), null);
  });

  await context.test("5xx is an upstream error", async () => {
    const provider = new WiktApiProvider({
      fetchFn: asFetch(async (input) =>
        String(input).includes("/definitions?")
          ? new Response(null, { status: 503 })
          : Response.json(fullEntryPayload()),
      ),
    });
    await assert.rejects(
      provider.lookup("test"),
      (error: unknown) =>
        error instanceof WordProviderError && error.code === "UPSTREAM_ERROR",
    );
  });

  await context.test("non-JSON is a parse error", async () => {
    const provider = new WiktApiProvider({
      fetchFn: asFetch(async (input) =>
        String(input).includes("/definitions?")
          ? new Response("{", {
              status: 200,
              headers: { "content-type": "application/json" },
            })
          : Response.json(fullEntryPayload()),
      ),
    });
    await assert.rejects(
      provider.lookup("test"),
      (error: unknown) =>
        error instanceof WordProviderError && error.code === "UPSTREAM_PARSE_ERROR",
    );
  });

  await context.test("timeout is an upstream timeout", async () => {
    const provider = new WiktApiProvider({
      timeoutMs: 5,
      fetchFn: asFetch(async (_input, init) => await pendingUntilAbort(init)),
    });
    await assert.rejects(
      provider.lookup("test"),
      (error: unknown) =>
        error instanceof WordProviderError && error.code === "UPSTREAM_TIMEOUT",
    );
  });

  await context.test("timeout while reading a 200 response body is an upstream timeout", async () => {
    const provider = new WiktApiProvider({
      timeoutMs: 5,
      fetchFn: asFetch(async (input, init) => {
        if (!String(input).includes("/definitions?")) {
          return Response.json(fullEntryPayload());
        }

        const response = new Response(null, { status: 200 });
        response.json = async () =>
          await new Promise<never>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
              once: true,
            });
          });
        return response;
      }),
    });

    await assert.rejects(
      provider.lookup("test"),
      (error: unknown) =>
        error instanceof WordProviderError && error.code === "UPSTREAM_TIMEOUT",
    );
  });
});

test("optional full-entry failures degrade to a definition-only DTO", async (context) => {
  for (const fullResponse of [
    { label: "404", response: () => new Response(null, { status: 404 }) },
    { label: "5xx", response: () => new Response(null, { status: 503 }) },
    {
      label: "non-JSON",
      response: () =>
        new Response("{", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    },
  ]) {
    await context.test(fullResponse.label, async () => {
      const provider = new WiktApiProvider({
        fetchFn: asFetch(async (input) =>
          String(input).includes("/definitions?")
            ? Response.json(definitionsPayload())
            : fullResponse.response(),
        ),
      });

      const entry = await provider.lookup("serendipity");
      assert.equal(entry?.meanings[0]?.pos, "noun");
      assert.equal(entry?.phonetic, "");
      assert.equal(entry?.audioUrl, undefined);
    });
  }

  await context.test("timeout", async () => {
    const provider = new WiktApiProvider({
      timeoutMs: 5,
      fetchFn: asFetch(async (input, init) =>
        String(input).includes("/definitions?")
          ? Response.json(definitionsPayload())
          : await pendingUntilAbort(init),
      ),
    });

    const entry = await provider.lookup("serendipity");
    assert.equal(entry?.meanings[0]?.pos, "noun");
    assert.equal(entry?.phonetic, "");
    assert.equal(entry?.audioUrl, undefined);
  });
});

test("WiktApiProvider enforces the five-second total timeout ceiling", () => {
  assert.throws(() => new WiktApiProvider({ timeoutMs: 5_001 }), RangeError);
});
