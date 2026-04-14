'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

interface QuestionResult {
  questionId: string;
  question: string;
  type: string;
  totalAnswers: number;
  average?: number;
  distribution?: Record<string, number>;
  counts?: Record<string, number>;
  responses?: string[];
}

interface Results {
  totalSubmissions: number;
  questions: QuestionResult[];
}

function getToken() {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

function Bar({ value, max }: { value: number; max: number }) {
  const pct = max ? Math.round((value / max) * 100) : 0;
  return (
    <div className="h-3 bg-gray-100 rounded overflow-hidden w-full">
      <div
        className="h-full bg-blue-500"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export default function SurveyDetailPage() {
  const params = useParams();
  const id = params?.id as string;
  const [survey, setSurvey] = useState<any>(null);
  const [results, setResults] = useState<Results | null>(null);

  useEffect(() => {
    if (!id) return;
    const token = getToken();
    const headers = { Authorization: `Bearer ${token}` };
    fetch(`${API_BASE}/api/v1/surveys/${id}`, { headers })
      .then((r) => r.json())
      .then(setSurvey);
    fetch(`${API_BASE}/api/v1/surveys/${id}/results`, { headers })
      .then((r) => r.json())
      .then(setResults);
  }, [id]);

  if (!survey || !results) return <p>Loading…</p>;

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold">{survey.name}</h1>
        {survey.description && (
          <p className="text-gray-600">{survey.description}</p>
        )}
        <p className="text-sm text-gray-500 mt-2">
          {results.totalSubmissions} submission(s)
        </p>
        <a
          className="text-sm text-blue-600 hover:underline"
          href={`/survey/${survey.hash}`}
          target="_blank"
          rel="noreferrer"
        >
          Public link
        </a>
      </div>

      <div className="space-y-6">
        {results.questions.map((q) => (
          <div key={q.questionId} className="bg-white p-4 rounded shadow">
            <h3 className="font-semibold">{q.question}</h3>
            <p className="text-xs text-gray-500 mb-3">
              {q.totalAnswers} answer(s)
            </p>

            {q.type === 'rating' && (
              <div>
                <p className="text-sm mb-2">
                  Average:{' '}
                  <span className="font-semibold">
                    {(q.average ?? 0).toFixed(2)}
                  </span>
                </p>
                {q.distribution &&
                  Object.entries(q.distribution).map(([k, v]) => (
                    <div
                      key={k}
                      className="flex items-center gap-2 text-sm mb-1"
                    >
                      <span className="w-6">{k}</span>
                      <Bar
                        value={v}
                        max={Math.max(...Object.values(q.distribution ?? {}))}
                      />
                      <span className="w-8 text-right">{v}</span>
                    </div>
                  ))}
              </div>
            )}

            {(q.type === 'radio' || q.type === 'checkbox') && q.counts && (
              <div>
                {Object.entries(q.counts).map(([k, v]) => (
                  <div
                    key={k}
                    className="flex items-center gap-2 text-sm mb-1"
                  >
                    <span className="w-32 truncate">{k}</span>
                    <Bar
                      value={v}
                      max={Math.max(...Object.values(q.counts ?? {}))}
                    />
                    <span className="w-8 text-right">{v}</span>
                  </div>
                ))}
              </div>
            )}

            {(q.type === 'text' || q.type === 'textarea') && (
              <ul className="list-disc pl-5 space-y-1 text-sm">
                {(q.responses ?? []).map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
