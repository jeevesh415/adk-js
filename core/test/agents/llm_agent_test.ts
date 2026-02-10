/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  BaseLlm,
  BaseLlmConnection,
  BasePlugin,
  CallbackContext,
  Event,
  InvocationContext,
  LlmAgent,
  LlmRequest,
  LlmResponse,
  PluginManager,
  Session,
  SingleAfterModelCallback,
  SingleBeforeModelCallback,
} from '@google/adk';
import {Content, Schema, Type} from '@google/genai';
import {z} from 'zod';
import {z as z3} from 'zod/v3';

import {AgentSchema} from '../../src/agents/llm_agent.js';

class MockLlmConnection implements BaseLlmConnection {
  sendHistory(_history: Content[]): Promise<void> {
    return Promise.resolve();
  }
  sendContent(_content: Content): Promise<void> {
    return Promise.resolve();
  }
  sendRealtime(_blob: {data: string; mimeType: string}): Promise<void> {
    return Promise.resolve();
  }
  async *receive(): AsyncGenerator<LlmResponse, void, void> {
    // No-op for mock.
  }
  async close(): Promise<void> {
    return Promise.resolve();
  }
}

class MockLlm extends BaseLlm {
  response: LlmResponse | null;
  error: Error | null;

  constructor(response: LlmResponse | null, error: Error | null = null) {
    super({model: 'mock-llm'});
    this.response = response;
    this.error = error;
  }

  async *generateContentAsync(
    _request: LlmRequest,
  ): AsyncGenerator<LlmResponse, void, void> {
    if (this.error) {
      throw this.error;
    }
    if (this.response) {
      yield this.response;
    }
  }

  async connect(_llmRequest: LlmRequest): Promise<BaseLlmConnection> {
    return new MockLlmConnection();
  }
}

class MockPlugin extends BasePlugin {
  beforeModelResponse?: LlmResponse;
  afterModelResponse?: LlmResponse;
  onModelErrorResponse?: LlmResponse;

  override async beforeModelCallback(_params: {
    callbackContext: CallbackContext;
    llmRequest: LlmRequest;
  }): Promise<LlmResponse | undefined> {
    return this.beforeModelResponse;
  }

  override async afterModelCallback(_params: {
    callbackContext: CallbackContext;
    llmResponse: LlmResponse;
  }): Promise<LlmResponse | undefined> {
    return this.afterModelResponse;
  }

  override async onModelErrorCallback(_params: {
    callbackContext: CallbackContext;
    llmRequest: LlmRequest;
    error: Error;
  }): Promise<LlmResponse | undefined> {
    return this.onModelErrorResponse;
  }
}

describe('LlmAgent.callLlm', () => {
  let agent: LlmAgent;
  let invocationContext: InvocationContext;
  let llmRequest: LlmRequest;
  let modelResponseEvent: Event;
  let pluginManager: PluginManager;
  let mockPlugin: MockPlugin;

  const originalLlmResponse: LlmResponse = {
    content: {parts: [{text: 'original'}]},
  };
  const beforePluginResponse: LlmResponse = {
    content: {parts: [{text: 'before plugin'}]},
  };
  const beforeCallbackResponse: LlmResponse = {
    content: {parts: [{text: 'before callback'}]},
  };
  const afterPluginResponse: LlmResponse = {
    content: {parts: [{text: 'after plugin'}]},
  };
  const afterCallbackResponse: LlmResponse = {
    content: {parts: [{text: 'after callback'}]},
  };
  const onModelErrorPluginResponse: LlmResponse = {
    content: {parts: [{text: 'on model error plugin'}]},
  };
  const modelError = new Error(
    JSON.stringify({
      error: {
        message: 'LLM error',
        code: 500,
      },
    }),
  );

  beforeEach(() => {
    mockPlugin = new MockPlugin('mock_plugin');
    pluginManager = new PluginManager();
    agent = new LlmAgent({name: 'test_agent'});
    invocationContext = new InvocationContext({
      invocationId: 'inv_123',
      session: {} as Session,
      agent: agent,
      pluginManager,
    });
    llmRequest = {contents: [], liveConnectConfig: {}, toolsDict: {}};
    modelResponseEvent = {id: 'evt_123'} as Event;
  });

  async function callLlmUnderTest(): Promise<LlmResponse[]> {
    const responses: LlmResponse[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for await (const response of (agent as any).callLlmAsync(
      invocationContext,
      llmRequest,
      modelResponseEvent,
    )) {
      responses.push(response);
    }
    return responses;
  }

  // 1. No plugins and no callbacks configured.
  it('returns unaltered LLM response with no plugins or callbacks', async () => {
    agent.model = new MockLlm(originalLlmResponse);
    const responses = await callLlmUnderTest();
    expect(responses).toEqual([originalLlmResponse]);
  });

  // 2. Plugin beforeModelCallback short circuits.
  it('short circuits when before model plugin callback returns a response', async () => {
    mockPlugin.beforeModelResponse = beforePluginResponse;
    pluginManager.registerPlugin(mockPlugin);
    const beforeCallback: SingleBeforeModelCallback = async () =>
      beforeCallbackResponse;
    agent.beforeModelCallback = [beforeCallback];
    agent.model = new MockLlm(originalLlmResponse);
    const responses = await callLlmUnderTest();
    expect(responses).toEqual([beforePluginResponse]);
  });

  // 3. Plugin beforeModelCallback returns undefined, canonical callback used.
  it('uses canonical before model callback when plugin returns undefined', async () => {
    pluginManager.registerPlugin(mockPlugin);
    const beforeCallback: SingleBeforeModelCallback = async () =>
      beforeCallbackResponse;
    agent.beforeModelCallback = [beforeCallback];
    agent.model = new MockLlm(originalLlmResponse);
    const responses = await callLlmUnderTest();
    expect(responses).toEqual([beforeCallbackResponse]);
  });

  // 4. Plugin afterModelCallback overrides response.
  it('uses plugin after model callback to override response', async () => {
    mockPlugin.afterModelResponse = afterPluginResponse;
    pluginManager.registerPlugin(mockPlugin);
    const afterCallback: SingleAfterModelCallback = async () =>
      afterCallbackResponse;
    agent.afterModelCallback = [afterCallback];
    agent.model = new MockLlm(originalLlmResponse);
    const responses = await callLlmUnderTest();
    expect(responses).toEqual([afterPluginResponse]);
  });

  // 5. No plugin afterModelCallback, canonical callback overrides.
  it('uses canonical after model callback when plugin returns undefined', async () => {
    pluginManager.registerPlugin(mockPlugin);
    const afterCallback: SingleAfterModelCallback = async () =>
      afterCallbackResponse;
    agent.afterModelCallback = [afterCallback];
    agent.model = new MockLlm(originalLlmResponse);
    const responses = await callLlmUnderTest();
    expect(responses).toEqual([afterCallbackResponse]);
  });

  // 6. LLM error, plugin onModelErrorCallback handles it.
  it('uses plugin on model error callback to handle LLM error', async () => {
    mockPlugin.onModelErrorResponse = onModelErrorPluginResponse;
    pluginManager.registerPlugin(mockPlugin);
    agent.model = new MockLlm(null, modelError);
    const responses = await callLlmUnderTest();
    expect(responses).toEqual([onModelErrorPluginResponse]);
  });

  // 7. LLM error, no plugin callback, error message propagates.
  it('propagates LLM error message when no plugin callback is present', async () => {
    pluginManager.registerPlugin(mockPlugin);
    agent.model = new MockLlm(null, modelError);
    const responses = await callLlmUnderTest();
    expect(responses).toEqual([{errorMessage: 'LLM error', errorCode: '500'}]);
  });
});

describe('LlmAgent Schema Initialization', () => {
  it('should initialize inputSchema from Schema object', () => {
    const inputSchema: Schema = {
      type: Type.OBJECT,
      properties: {foo: {type: Type.STRING}},
    };
    const agent = new LlmAgent({name: 'test', inputSchema});
    expect(agent.inputSchema).toEqual(inputSchema);
  });

  it('should initialize inputSchema from Zod object', () => {
    const zodSchema = z.object({foo: z.string()}) as unknown as AgentSchema;
    const agent = new LlmAgent({
      name: 'test',
      inputSchema: zodSchema as unknown as Schema,
    });
    expect(agent.inputSchema).toBeDefined();
    expect((agent.inputSchema as Schema).type).toBe('OBJECT');
    expect((agent.inputSchema as Schema).properties?.foo?.type).toBe('STRING');
  });

  it('should initialize inputSchema from Zod v3 object', () => {
    const zodSchema = z3.object({foo: z3.string()}) as unknown as AgentSchema;
    const agent = new LlmAgent({
      name: 'test',
      inputSchema: zodSchema as unknown as Schema,
    });
    expect(agent.inputSchema).toBeDefined();
    expect((agent.inputSchema as Schema).type).toBe('OBJECT');
    expect((agent.inputSchema as Schema).properties?.foo?.type).toBe('STRING');
  });

  it('should initialize outputSchema from Schema object', () => {
    const outputSchema: Schema = {
      type: Type.OBJECT,
      properties: {bar: {type: Type.NUMBER}},
    };
    const agent = new LlmAgent({name: 'test', outputSchema});
    expect(agent.outputSchema).toEqual(outputSchema);
  });

  it('should initialize outputSchema from Zod object', () => {
    const zodSchema = z.object({bar: z.number()}) as unknown as AgentSchema;
    const agent = new LlmAgent({
      name: 'test',
      outputSchema: zodSchema as unknown as Schema,
    });
    expect(agent.outputSchema).toBeDefined();
    expect((agent.outputSchema as Schema).type).toBe('OBJECT');
    expect((agent.outputSchema as Schema).properties?.bar?.type).toBe('NUMBER');
  });

  it('should initialize outputSchema from Zod v3 object', () => {
    const zodSchema = z3.object({bar: z3.number()}) as unknown as AgentSchema;
    const agent = new LlmAgent({
      name: 'test',
      outputSchema: zodSchema as unknown as Schema,
    });
    expect(agent.outputSchema).toBeDefined();
    expect((agent.outputSchema as Schema).type).toBe('OBJECT');
    expect((agent.outputSchema as Schema).properties?.bar?.type).toBe('NUMBER');
  });

  it('should enforce transfer restrictions when outputSchema is present', () => {
    const outputSchema: Schema = {type: Type.OBJECT};
    const agent = new LlmAgent({
      name: 'test',
      outputSchema,
      disallowTransferToParent: false,
      disallowTransferToPeers: false,
    });
    expect(agent.disallowTransferToParent).toBe(true);
    expect(agent.disallowTransferToPeers).toBe(true);
  });
});

describe('LlmAgent Output Processing', () => {
  let agent: LlmAgent;
  let invocationContext: InvocationContext;
  let validationSchema: Schema;

  beforeEach(() => {
    validationSchema = {
      type: Type.OBJECT,
      properties: {
        answer: {type: Type.STRING},
      },
    };
    agent = new LlmAgent({
      name: 'test_agent',
      outputSchema: validationSchema,
      outputKey: 'result',
    });
    const mockState = {
      hasDelta: () => false,
      get: () => undefined,
      set: () => {},
    };
    invocationContext = new InvocationContext({
      invocationId: 'inv_123',
      session: {
        id: 'sess_123',
        state: mockState,
        events: [],
      } as unknown as Session,
      agent: agent,
      pluginManager: new PluginManager(),
    });
  });

  it('should save parsed JSON output to state based on outputKey', async () => {
    const jsonOutput = JSON.stringify({answer: '42'});
    const response: LlmResponse = {
      content: {parts: [{text: jsonOutput}]},
    };
    agent.model = new MockLlm(response);

    const generator = agent.runAsync(invocationContext);
    const events: Event[] = [];
    for await (const event of generator) {
      events.push(event);
    }

    const lastEvent = events[events.length - 1];
    expect(lastEvent).toBeDefined();
    expect(lastEvent.content?.parts?.[0].text).toEqual(jsonOutput);
    expect(lastEvent.actions?.stateDelta).toBeDefined();
    expect(lastEvent.actions?.stateDelta?.['result']).toEqual({answer: '42'});
  });

  it('should not save output if invalid JSON', async () => {
    const invalidJson = '{answer: 42'; // Missing closing brace
    const response: LlmResponse = {
      content: {parts: [{text: invalidJson}]},
    };
    agent.model = new MockLlm(response);

    const generator = agent.runAsync(invocationContext);
    const events: Event[] = [];
    for await (const event of generator) {
      events.push(event);
    }

    const lastEvent = events[events.length - 1];
    expect(lastEvent.actions?.stateDelta?.['result']).toEqual(invalidJson);
  });
});
