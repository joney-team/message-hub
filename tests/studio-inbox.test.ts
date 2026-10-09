// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Inbox } from '@/studio/Inbox';
import type { ConversationDto, StudioMessageDto } from '@/studio/types';

const { studioApiMock } = vi.hoisted(() => ({ studioApiMock: vi.fn() }));

vi.mock('@/studio/api', () => ({ studioApi: studioApiMock }));

const message: StudioMessageDto = {
  id: 'msg_1',
  seq: 1,
  direction: 'inbound',
  text: 'Hello',
  attachments: [],
  sender: null,
  context: null,
  clientMessageId: 'client_1',
  createdAt: '2026-10-09T01:00:00.000Z',
};

const conversation: ConversationDto = {
  visitor: {
    id: 'vis_1',
    channelId: 'ch_1',
    locale: 'en',
    profile: { name: 'Taylor' },
    userAgent: null,
    origin: 'https://example.com',
    lastSeenAt: '2026-10-09T01:00:00.000Z',
    createdAt: '2026-10-09T01:00:00.000Z',
  },
  channel: { id: 'ch_1', name: 'Support', ref: null },
  latestMessage: message,
};

describe('Studio inbox', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    studioApiMock.mockReset();
  });

  it('confirms and deletes every message in the selected conversation', async () => {
    let deleted = false;
    studioApiMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.startsWith('/api/v1/conversations')) {
        return { data: deleted ? [] : [conversation], hasMore: false };
      }
      if (path === '/api/v1/visitors/vis_1/messages?limit=50') {
        return { data: [message], hasMore: false };
      }
      if (path === '/api/v1/visitors/vis_1/messages' && init?.method === 'DELETE') {
        deleted = true;
        return undefined;
      }
      throw new Error(`Unexpected Studio API call: ${init?.method ?? 'GET'} ${path}`);
    });

    await act(async () => {
      root.render(createElement(Inbox, { channels: [] }));
    });
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      });
    }

    const button = container.querySelector<HTMLButtonElement>('[aria-label="Delete conversation"]');
    expect(button).not.toBeNull();

    await act(async () => {
      button!.click();
    });
    for (let i = 0; i < 2; i++) {
      await act(async () => {
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      });
    }

    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('permanently deletes all messages'));
    expect(studioApiMock).toHaveBeenCalledWith('/api/v1/visitors/vis_1/messages', { method: 'DELETE' });
    expect(container.textContent).toContain('No customer messages yet');
    expect(container.textContent).not.toContain('Taylor');
  });
});
