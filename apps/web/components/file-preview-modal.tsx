'use client';

import { useState, useEffect } from 'react';

interface FilePreviewModalProps {
  url: string;
  fileName: string;
  mimeType: string;
  onClose: () => void;
}

function isImage(mimeType: string): boolean {
  return /^image\/(jpeg|jpg|png|gif|webp|svg|bmp)$/i.test(mimeType);
}

function isPdf(mimeType: string): boolean {
  return mimeType === 'application/pdf';
}

function isText(mimeType: string): boolean {
  return (
    mimeType.startsWith('text/') ||
    mimeType === 'application/json' ||
    mimeType === 'application/xml' ||
    mimeType === 'application/javascript'
  );
}

export function FilePreviewModal({
  url,
  fileName,
  mimeType,
  onClose,
}: FilePreviewModalProps) {
  const [textContent, setTextContent] = useState<string | null>(null);
  const [textLoading, setTextLoading] = useState(false);

  useEffect(() => {
    if (isText(mimeType)) {
      setTextLoading(true);
      fetch(url)
        .then(async (res) => {
          if (res.ok) {
            const text = await res.text();
            setTextContent(text);
          } else {
            setTextContent('Failed to load file content.');
          }
        })
        .catch(() => setTextContent('Failed to load file content.'))
        .finally(() => setTextLoading(false));
    }
  }, [url, mimeType]);

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-xl max-w-5xl w-full max-h-[90vh] flex flex-col overflow-hidden shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
          <div className="flex items-center gap-3 min-w-0">
            <h3 className="font-semibold text-gray-900 truncate">{fileName}</h3>
            <span className="text-xs text-gray-400 flex-shrink-0">{mimeType}</span>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <a
              href={url}
              download={fileName}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
              Download
            </a>
            <button
              onClick={onClose}
              className="p-1.5 text-gray-400 hover:text-gray-600 rounded-md hover:bg-gray-100 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4 flex items-center justify-center">
          {isImage(mimeType) ? (
            <img
              src={url}
              alt={fileName}
              className="max-w-full max-h-[75vh] object-contain rounded"
            />
          ) : isPdf(mimeType) ? (
            <iframe
              src={url}
              title={fileName}
              className="w-full h-[75vh] rounded border border-gray-200"
            />
          ) : isText(mimeType) ? (
            <div className="w-full h-full">
              {textLoading ? (
                <div className="flex items-center justify-center h-48">
                  <p className="text-sm text-gray-400">Loading content...</p>
                </div>
              ) : (
                <pre className="w-full max-h-[75vh] overflow-auto bg-gray-50 rounded-lg border border-gray-200 p-4 text-sm text-gray-800 font-mono whitespace-pre-wrap">
                  {textContent}
                </pre>
              )}
            </div>
          ) : (
            /* Unknown file type */
            <div className="text-center py-16">
              <div className="w-20 h-20 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
                <svg className="w-10 h-10 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                </svg>
              </div>
              <p className="text-sm text-gray-500 mb-3">
                Preview is not available for this file type.
              </p>
              <a
                href={url}
                download={fileName}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
                Download File
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
