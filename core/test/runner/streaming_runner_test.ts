/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  AgentEventType,
  BaseAgent,
  createEvent,
  Event,
  InMemoryArtifactService,
  InMemorySessionService,
  InvocationContext,
  LlmAgent,
  Runner,
} from '@google/adk';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {convertEventToAgentEvents} from '../../src/runner/runner.js';

const TEST_APP_ID = 'test_app_id';
const TEST_USER_ID = 'test_user_id';
const TEST_SESSION_ID = 'test_session_id';

class MockLlmAgent extends LlmAgent {
  constructor(
    name: string,
    disallowTransferToParent = false,
    parentAgent?: BaseAgent,
  ) {
    super({
      name,
      model: 'gemini-2.5-flash',
      subAgents: [],
      parentAgent,
      disallowTransferToParent,
    });
  }

  protected override async *runAsyncImpl(
    context: InvocationContext,
  ): AsyncGenerator<Event, void, void> {
    yield createEvent({
      invocationId: context.invocationId,
      author: this.name,
      content: {
        role: 'model',
        parts: [
          {text: 'Test LLM response'},
          {functionCall: {name: 'test_tool', args: {}}},
        ],
      },
    });
    yield createEvent({
      invocationId: context.invocationId,
      author: this.name,
      // Simulate thought
      content: {
        role: 'model',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        parts: [{text: 'I am thinking', thought: true} as any],
      },
    });
  }
}

describe('Runner Streaming and Stateless', () => {
  let sessionService: InMemorySessionService;
  let artifactService: InMemoryArtifactService;
  let rootAgent: MockLlmAgent;
  let runner: Runner;

  beforeEach(() => {
    sessionService = new InMemorySessionService();
    artifactService = new InMemoryArtifactService();
    rootAgent = new MockLlmAgent('root_agent');

    runner = new Runner({
      appName: TEST_APP_ID,
      agent: rootAgent,
      sessionService,
      artifactService,
    });
  });

  describe('runStream', () => {
    it('should yield standardized AgentEvents', async () => {
      const session = await sessionService.createSession({
        appName: TEST_APP_ID,
        userId: TEST_USER_ID,
        sessionId: TEST_SESSION_ID,
      });

      const events = [];
      for await (const event of runner.runStream({
        userId: session.userId,
        sessionId: session.id,
        newMessage: {role: 'user', parts: [{text: 'Hello'}]},
      })) {
        events.push(event);
      }

      // Check for Content
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: AgentEventType.CONTENT,
            content: 'Test LLM response',
          }),
        ]),
      );

      // Check for Tool Call
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: AgentEventType.TOOL_CALL,
            call: expect.objectContaining({name: 'test_tool'}),
          }),
        ]),
      );

      // Check for Thought
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: AgentEventType.THOUGHT,
            content: 'I am thinking',
          }),
        ]),
      );
    });
  });

  describe('runStateless', () => {
    it('should run freely without managing session manually', async () => {
      const events = [];
      for await (const event of runner.runStateless({
        userId: TEST_USER_ID,
        newMessage: {role: 'user', parts: [{text: 'Hello'}]},
      })) {
        events.push(event);
      }

      expect(events.length).toBeGreaterThan(0);
      expect(events[0].type).toBeDefined();
    });

    it('should cleanup session after run', async () => {
      // We can't easily verify session cleanup with InMemorySessionService as it doesn't expose deleted sessions easily
      // But we can verify it runs successfully.
      // To verify cleanup, we'd need to mock SessionService or check internal state if possible.
      // For now, assume if it runs and returns, it's fine.
      const generator = runner.runStateless({
        userId: TEST_USER_ID,
        newMessage: {role: 'user', parts: [{text: 'Hello'}]},
      });

      for await (const _ of generator) {
        // consume
      }

      // If we tried to reuse a generated ID (which we don't have access to), it would fail or succeed depending on logic.
      // Since we can't easily access the internal ID, we trust the implementation for now or spy on deleteSession.
      const spy = vi.spyOn(sessionService, 'deleteSession');

      const generator2 = runner.runStateless({
        userId: TEST_USER_ID,
        newMessage: {role: 'user', parts: [{text: 'Hello'}]},
      });
      for await (const _ of generator2) {
        // consume
      }

      expect(spy).toHaveBeenCalled();
    });
  });

  describe('convertEventToAgentEvents', () => {
    it('should convert error events', () => {
      const event: Event = {
        errorCode: 500,
        errorMessage: 'Test Error',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;
      const generator = convertEventToAgentEvents(event);
      const result = generator.next().value;
      expect(result).toEqual({
        type: AgentEventType.ERROR,
        error: new Error('Test Error'),
      });
    });

    it('should convert content events', () => {
      const event = createEvent({
        invocationId: 'id',
        author: 'model',
        content: {role: 'model', parts: [{text: 'Hello'}]},
      });
      const generator = convertEventToAgentEvents(event);
      const result = generator.next().value;
      expect(result).toEqual({
        type: AgentEventType.CONTENT,
        content: 'Hello',
      });
    });

    it('should convert tool call events', () => {
      const event = createEvent({
        invocationId: 'id',
        author: 'model',
        content: {
          role: 'model',
          parts: [{functionCall: {name: 'tool', args: {}}}],
        },
      });
      const generator = convertEventToAgentEvents(event);
      const result = generator.next().value;
      expect(result).toEqual({
        type: AgentEventType.TOOL_CALL,
        call: {name: 'tool', args: {}},
      });
    });

    it('should convert tool response events', () => {
      const event = createEvent({
        invocationId: 'id',
        author: 'model',
        content: {
          role: 'model',
          parts: [{functionResponse: {name: 'tool', response: {}}}],
        },
      });
      const generator = convertEventToAgentEvents(event);
      const result = generator.next().value;
      expect(result).toEqual({
        type: AgentEventType.TOOL_RESULT,
        result: {name: 'tool', response: {}},
      });
    });

    it('should convert thought events', () => {
      const event = createEvent({
        invocationId: 'id',
        author: 'model',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        content: {
          role: 'model',
          parts: [{text: 'Thinking...', thought: true} as any],
        },
      });
      const generator = convertEventToAgentEvents(event);
      const result = generator.next().value;
      expect(result).toEqual({
        type: AgentEventType.THOUGHT,
        content: 'Thinking...',
      });
    });
  });
});
