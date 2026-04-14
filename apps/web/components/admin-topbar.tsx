'use client';

import { Bell, Search, ChevronDown, LogOut, User, Settings } from 'lucide-react';
import { signOut } from 'next-auth/react';
import { useState } from 'react';

interface TopbarProps {
  user: any;
}

export function AdminTopbar({ user }: TopbarProps) {
  const [showMenu, setShowMenu] = useState(false);

  return (
    <header className="h-14 flex items-center justify-between px-6 bg-white border-b border-gray-100 flex-shrink-0">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          placeholder="Search clients, invoices, tasks..."
          className="pl-9 pr-4 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg w-64 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
        />
      </div>

      <div className="flex items-center gap-3">
        {/* Notifications */}
        <button className="relative p-2 hover:bg-gray-100 rounded-lg">
          <Bell className="w-5 h-5 text-gray-500" />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full" />
        </button>

        {/* User menu */}
        <div className="relative">
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="flex items-center gap-2 hover:bg-gray-100 rounded-lg px-2 py-1.5"
          >
            <div className="w-7 h-7 bg-primary rounded-full flex items-center justify-center text-white text-xs font-medium">
              {user?.name?.[0] || user?.email?.[0] || 'U'}
            </div>
            <span className="text-sm font-medium text-gray-700">
              {user?.name || user?.email}
            </span>
            <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
          </button>

          {showMenu && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => setShowMenu(false)}
              />
              <div className="absolute right-0 mt-1 w-48 bg-white rounded-xl shadow-lg border border-gray-100 py-1 z-20">
                <a
                  href="/profile"
                  className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  <User className="w-4 h-4" />
                  My Profile
                </a>
                <a
                  href="/settings/general"
                  className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  <Settings className="w-4 h-4" />
                  Settings
                </a>
                <div className="h-px bg-gray-100 my-1" />
                <button
                  onClick={() => signOut({ callbackUrl: '/login' })}
                  className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50"
                >
                  <LogOut className="w-4 h-4" />
                  Sign out
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
