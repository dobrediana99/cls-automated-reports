/**
 * Unit tests for OpenRouter client hardening: timeout, response_format fallback,
 * JSON invalid retry, schema repair retry.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const validEmployeeJson = () =>
  '{"interpretareHtml":"<p>I</p>","concluziiHtml":"<p>C</p>","actiuniHtml":"<p>A</p>","planHtml":"<p>P</p>"}';

const okEmployeeResponse = () =>
  Promise.resolve({
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({
        choices: [{ message: { content: validEmployeeJson() } }],
        model: 'test',
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
  });

describe('openrouterClient hardening', () => {
  let fetchMock;

  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.OPENROUTER_USE_JSON_SCHEMA;
  });

  it('400 unsupported response_format -> fallback to json_object', async () => {
    const { generateMonthlySections } = await import('./openrouterClient.js');
    process.env.OPENROUTER_USE_JSON_SCHEMA = 'true';

    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: () =>
          Promise.resolve(
            'response_format json_schema is not supported for this model'
          ),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            choices: [{ message: { content: validEmployeeJson() } }],
            model: 'test',
            usage: {},
          }),
      });

    const result = await generateMonthlySections({
      systemPrompt: 'S',
      inputJson: {},
    });

    expect(result).toEqual({
      interpretareHtml: '<p>I</p>',
      concluziiHtml: '<p>C</p>',
      actiuniHtml: '<p>A</p>',
      planHtml: '<p>P</p>',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const firstBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(firstBody.response_format?.json_schema).toBeDefined();
    expect(secondBody.response_format).toEqual({ type: 'json_object' });
  });

  it('JSON invalid -> retry with STRICT_JSON_APPEND', async () => {
    const { generateMonthlySections } = await import('./openrouterClient.js');

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            choices: [{ message: { content: 'not valid json' } }],
            model: 'test',
            usage: {},
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            choices: [{ message: { content: validEmployeeJson() } }],
            model: 'test',
            usage: {},
          }),
      });

    const result = await generateMonthlySections({
      systemPrompt: 'S',
      inputJson: {},
    });

    expect(result.interpretareHtml).toBe('<p>I</p>');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    const userContent = secondBody.messages?.find((m) => m.role === 'user')
      ?.content;
    expect(userContent).toContain('Return ONLY valid JSON object');
  });

  it('schema invalid (missing key) -> repair retry', async () => {
    const { generateMonthlySections } = await import('./openrouterClient.js');

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            choices: [
              {
                message: {
                  content:
                    '{"interpretareHtml":"a","concluziiHtml":"b","actiuniHtml":"c"}',
                },
              },
            ],
            model: 'test',
            usage: {},
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            choices: [{ message: { content: validEmployeeJson() } }],
            model: 'test',
            usage: {},
          }),
      });

    const result = await generateMonthlySections({
      systemPrompt: 'S',
      inputJson: {},
    });

    expect(result.planHtml).toBe('<p>P</p>');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const repairBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    const repairUser = repairBody.messages?.find((m) => m.role === 'user')
      ?.content;
    expect(repairUser).toContain('Schema validation failed');
    expect(repairUser).toContain('ALL required keys present');
  });

  it('AbortError (timeout) -> retry', async () => {
    const { generateMonthlySections } = await import('./openrouterClient.js');

    fetchMock
      .mockRejectedValueOnce((() => {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        return err;
      })())
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            choices: [{ message: { content: validEmployeeJson() } }],
            model: 'test',
            usage: {},
          }),
      });

    const result = await generateMonthlySections({
      systemPrompt: 'S',
      inputJson: {},
    });

    expect(result.interpretareHtml).toBe('<p>I</p>');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('fenced JSON (```json ... ```) is cleaned and parse succeeds', async () => {
    const { generateMonthlySections } = await import('./openrouterClient.js');
    const raw = validEmployeeJson();
    const fencedContent = '```json\n' + raw + '\n```';

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: fencedContent } }],
          model: 'test',
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
    });

    const result = await generateMonthlySections({
      systemPrompt: 'S',
      inputJson: {},
    });

    expect(result).toEqual({
      interpretareHtml: '<p>I</p>',
      concluziiHtml: '<p>C</p>',
      actiuniHtml: '<p>A</p>',
      planHtml: '<p>P</p>',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('prose around JSON is stripped and parse succeeds', async () => {
    const { generateMonthlySections } = await import('./openrouterClient.js');
    const raw = validEmployeeJson();
    const wrappedContent = 'Here is the JSON:\n' + raw + '\nThanks.';

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: wrappedContent } }],
          model: 'test',
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
    });

    const result = await generateMonthlySections({
      systemPrompt: 'S',
      inputJson: {},
    });

    expect(result).toEqual({
      interpretareHtml: '<p>I</p>',
      concluziiHtml: '<p>C</p>',
      actiuniHtml: '<p>A</p>',
      planHtml: '<p>P</p>',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
