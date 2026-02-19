/**
 * Unit tests for OpenRouter client hardening: timeout, response_format fallback,
 * JSON invalid retry, schema repair retry. Uses new strict employee structure (antet, sectiuni, incheiere).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LLM_ERROR_REASONS } from './openrouterClient.js';

/** Minimal valid employee output (no sectiunea_6; for performancePct >= 80). */
function getValidEmployeePayload() {
  return {
    antet: { subiect: 'Raport', greeting: 'Bună,', intro_message: 'Intro' },
    sectiunea_1_tabel_date_performanta: { continut: ['Row 1'] },
    sectiunea_2_interpretare_date: { stil: 'Obiectiv', include: ['Item 1'] },
    sectiunea_3_concluzii: {
      ce_merge_bine: 'A',
      ce_nu_merge_si_necesita_interventie_urgenta: 'B',
      focus_luna_urmatoare: 'C',
    },
    sectiunea_4_actiuni_prioritare: {
      format_actiune: 'Format',
      structura: { ce: 'x', de_ce: 'y', masurabil: 'z', deadline: 'd' },
      actiuni_specifice_per_rol: {
        freight_forwarder: ['F1'],
        sales_freight_agent: ['S1'],
      },
    },
    sectiunea_5_plan_saptamanal: {
      format: { saptamana_1: 'S1', saptamana_2_4: 'S2-4' },
    },
    incheiere: {
      raport_urmator: 'Next',
      mesaj_sub_80: 'Sub 80',
      mesaj_peste_80: 'Peste 80',
      semnatura: { nume: 'N', functie: 'F', companie: 'C' },
    },
  };
}

const validEmployeeJson = () => JSON.stringify(getValidEmployeePayload());

describe('openrouterClient hardening', () => {
  let fetchMock;

  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    // Use a non-Anthropic model in tests so response_format is honored
    process.env.OPENROUTER_MODEL = 'openai/gpt-4.1';
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.OPENROUTER_USE_JSON_SCHEMA;
    delete process.env.OPENROUTER_MODEL;
  });

  it('exposes standardized LLM error reason taxonomy constants', () => {
    expect(LLM_ERROR_REASONS.PARSE_FAIL).toBe('parse_fail');
    expect(LLM_ERROR_REASONS.SCHEMA_FAIL).toBe('schema_fail');
    expect(LLM_ERROR_REASONS.CHECKIN_RULE_FAIL).toBe('checkin_rule_fail');
    expect(LLM_ERROR_REASONS.CLOSING_MESSAGE_RULE_FAIL).toBe(
      'closing_message_rule_fail'
    );
    expect(LLM_ERROR_REASONS.TRANSPORT_FAIL).toBe('transport_fail');
    // The detailed mapping is exercised indirectly in generateMonthlySections tests below.
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
      performancePct: 85,
    });

    expect(result.sections).toHaveProperty('antet');
    expect(result.sections.antet.subiect).toBe('Raport');
    expect(result.sections).toHaveProperty('sectiunea_2_interpretare_date');
    expect(result.sections).toHaveProperty('incheiere');
    expect(result.usage).toBeDefined();
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
      performancePct: 90,
    });

    expect(result.sections.antet.subiect).toBe('Raport');
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
                  content: '{"antet":{"subiect":"x","greeting":"y","intro_message":"z"},"sectiunea_1_tabel_date_performanta":{"continut":["a"]}}',
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
      performancePct: 85,
    });

    expect(result.sections.sectiunea_5_plan_saptamanal.format.saptamana_1).toBe('S1');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const repairBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    const repairUser = repairBody.messages?.find((m) => m.role === 'user')
      ?.content;
    expect(repairUser).toContain('Returnează DOAR JSON valid');
    expect(repairUser).toContain('additionalProperties');
    expect(repairUser).toContain('saptamana_1');
    expect(repairUser).toContain('saptamana_2_4');
    expect(repairUser).toContain('mesaj_sub_80');
    expect(repairUser).toContain('mesaj_peste_80');
  });

  it('schema invalid twice -> final error has correlation requestId + repairRequestId', async () => {
    const { generateMonthlySections } = await import('./openrouterClient.js');

    // Both responses are valid JSON but fail schema validation
    const invalidJson = '{"antet":{"subiect":"x"},"sectiunea_1_tabel_date_performanta":{"continut":["a"]}}';

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            choices: [{ message: { content: invalidJson } }],
            model: 'test',
            usage: {},
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            choices: [{ message: { content: invalidJson } }],
            model: 'test',
            usage: {},
          }),
      });

    let caught;
    try {
      await generateMonthlySections({
        systemPrompt: 'S',
        inputJson: {},
        performancePct: 85,
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
    expect(caught.reason).toBe(LLM_ERROR_REASONS.SCHEMA_FAIL);
    expect(typeof caught.requestId === 'string' || caught.requestId === null).toBe(
      true
    );
    expect(
      typeof caught.repairRequestId === 'string' || caught.repairRequestId === null
    ).toBe(true);
  });

  it('first response schema-invalid (section 5 wrong shape + empty incheiere messages) succeeds after normalization without retry', async () => {
    const { generateMonthlySections } = await import('./openrouterClient.js');
    const payload = getValidEmployeePayload();
    payload.sectiunea_5_plan_saptamanal = { format: { saptamana_1: 'S1' } };
    payload.incheiere.mesaj_peste_80 = '';
    payload.incheiere.mesaj_sub_80 = '';
    const invalidOnceJson = JSON.stringify(payload);

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: invalidOnceJson } }],
          model: 'test',
          usage: {},
        }),
    });

    const result = await generateMonthlySections({
      systemPrompt: 'S',
      inputJson: {},
      performancePct: 85,
    });

    expect(result.sections.sectiunea_5_plan_saptamanal.format.saptamana_1).toBe('S1');
    expect(result.sections.sectiunea_5_plan_saptamanal.format.saptamana_2_4).toBeDefined();
    expect(result.sections.sectiunea_5_plan_saptamanal.format.saptamana_2_4.length).toBeGreaterThan(0);
    expect(result.sections.incheiere.mesaj_peste_80.length).toBeGreaterThan(0);
    expect(result.sections.incheiere.mesaj_sub_80.length).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
      performancePct: 85,
    });

    expect(result.sections.antet.subiect).toBe('Raport');
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
      performancePct: 85,
    });

    expect(result.sections).toHaveProperty('antet');
    expect(result.sections.antet.subiect).toBe('Raport');
    expect(result.sections).toHaveProperty('incheiere');
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
      performancePct: 85,
    });

    expect(result.sections.antet.subiect).toBe('Raport');
    expect(result.sections.sectiunea_3_concluzii.focus_luna_urmatoare).toBe('C');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('response_format fallback exhausts all 3 levels (400 each time) -> throws', async () => {
    const { generateMonthlySections } = await import('./openrouterClient.js');
    process.env.OPENROUTER_USE_JSON_SCHEMA = 'true';

    const badBody = 'response_format json_schema is not supported for this model';
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: () => Promise.resolve(badBody),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: () => Promise.resolve('response_format type json_object not supported'),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: () => Promise.resolve('response_format unsupported'),
      });

    await expect(
      generateMonthlySections({ systemPrompt: 'S', inputJson: {}, performancePct: 85 })
    ).rejects.toThrow();

    expect(fetchMock).toHaveBeenCalledTimes(3);

    const body0 = JSON.parse(fetchMock.mock.calls[0][1].body);
    const body1 = JSON.parse(fetchMock.mock.calls[1][1].body);
    const body2 = JSON.parse(fetchMock.mock.calls[2][1].body);

    expect(body0.response_format?.json_schema).toBeDefined();
    expect(body1.response_format).toEqual({ type: 'json_object' });
    expect(body2.response_format).toBeUndefined();
  });
});
