'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';

interface Comment {
  id: string;
  content: string;
  addedBy: string;
  createdAt: string;
}

interface Proposal {
  id: string;
  title: string;
  content: string;
  status: string;
  organization?: { name: string } | null;
  comments?: Comment[];
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export default function ProposalViewPage() {
  const params = useParams();
  const hash = params.hash as string;

  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const [commentText, setCommentText] = useState('');
  const [commentName, setCommentName] = useState('');
  const [postingComment, setPostingComment] = useState(false);

  const fetchProposal = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/proposals/view/${hash}`);
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      setProposal(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load proposal');
    } finally {
      setLoading(false);
    }
  }, [hash]);

  useEffect(() => {
    fetchProposal();
  }, [fetchProposal]);

  useEffect(() => {
    if (!proposal) return;
    fetch(`${API_BASE}/api/v1/proposals/view/${hash}/open`, { method: 'POST' }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposal?.id]);

  async function action(path: string, label: string) {
    setActing(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/proposals/view/${hash}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error(`Failed with status ${res.status}`);
      setDone(label);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed');
    } finally {
      setActing(false);
    }
  }

  async function postComment(e: React.FormEvent) {
    e.preventDefault();
    if (!commentText.trim() || !commentName.trim()) return;
    setPostingComment(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/proposals/view/${hash}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: commentText, addedBy: commentName }),
      });
      if (!res.ok) throw new Error('Failed');
      setCommentText('');
      fetchProposal();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed');
    } finally {
      setPostingComment(false);
    }
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center text-sm text-gray-400 dark:text-gray-500">Loading…</div>;

  if (error || !proposal) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="max-w-md text-center">
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">Proposal Not Available</h1>
          <p className="text-sm text-red-600">{error ?? 'Not found'}</p>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-gray-50 dark:bg-gray-900">
        <div className="max-w-md text-center bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm p-8">
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">Thank you!</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Proposal {done}.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-10 px-4">
      <div className="max-w-3xl mx-auto">
        {proposal.organization?.name && (
          <p className="text-center text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">{proposal.organization.name}</p>
        )}
        <h1 className="text-center text-2xl font-bold text-gray-900 dark:text-gray-100 mb-8">{proposal.title}</h1>

        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm p-8 mb-6">
          <div
            className="prose prose-sm max-w-none text-gray-700 dark:text-gray-300"
            dangerouslySetInnerHTML={{ __html: proposal.content }}
          />
        </div>

        <div className="flex gap-3 mb-8">
          <button
            onClick={() => action('/accept', 'accepted')}
            disabled={acting}
            className="flex-1 px-4 py-4 text-base font-semibold bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
          >
            Accept Proposal
          </button>
          <button
            onClick={() => action('/decline', 'declined')}
            disabled={acting}
            className="flex-1 px-4 py-4 text-base font-semibold bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
          >
            Decline
          </button>
        </div>

        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Comments</h2>
          {(!proposal.comments || proposal.comments.length === 0) ? (
            <p className="text-sm text-gray-400 dark:text-gray-500 mb-4">No comments yet.</p>
          ) : (
            <ul className="space-y-3 mb-4">
              {proposal.comments.map((c) => (
                <li key={c.id} className="border-b border-gray-100 dark:border-gray-800 pb-3 last:border-0">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{c.addedBy}</span>
                    <span className="text-xs text-gray-400 dark:text-gray-500">{new Date(c.createdAt).toLocaleString()}</span>
                  </div>
                  <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{c.content}</p>
                </li>
              ))}
            </ul>
          )}

          <form onSubmit={postComment} className="space-y-3 border-t border-gray-100 dark:border-gray-800 pt-4">
            <input
              type="text"
              placeholder="Your name"
              value={commentName}
              onChange={(e) => setCommentName(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            />
            <textarea
              rows={3}
              placeholder="Add a comment…"
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            />
            <button
              type="submit"
              disabled={postingComment || !commentText.trim() || !commentName.trim()}
              className="px-4 py-2 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50"
            >
              {postingComment ? 'Posting…' : 'Post Comment'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
