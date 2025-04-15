import { useState } from 'react';
import RevenuePage from './pages/RevenuePage';
import SyncPage from './pages/SyncPage';
import { Button } from '@/components/ui/button';
// import './globals.css';

function App() {
  const [currentPage, setCurrentPage] = useState<'revenue' | 'sync'>('revenue');

  return (
    <div style={{
      minHeight: "100vh",
      width: "100%",
      maxWidth: "100%",
      display: "flex",
      flexDirection: "column",
      fontSize: "14px",
      backgroundColor: "#f9fafb"
    }}>
      {/* Header met navigatie */}
      <header className="border-b border-gray-200 bg-white shadow-sm py-2">
        <div style={{
          width: "100%",
          maxWidth: "100%",
          margin: "0 auto",
          padding: "0 16px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center"
        }}>
          <h1 className="text-lg font-semibold tracking-tight">IRIS Revenue App</h1>
          <nav className="flex gap-1">
            <Button 
              variant={currentPage === 'revenue' ? 'default' : 'outline'}
              onClick={() => setCurrentPage('revenue')}
              size="sm"
              className="rounded-md border-gray-200 text-xs font-medium"
            >
              Revenue Overzicht
            </Button>
            <Button 
              variant={currentPage === 'sync' ? 'default' : 'outline'}
              onClick={() => setCurrentPage('sync')}
              size="sm"
              className="rounded-md border-gray-200 text-xs font-medium"
            >
              Synchronisatie
            </Button>
          </nav>
        </div>
      </header>
      
      {/* Main content */}
      <main style={{
        flexGrow: 1,
        padding: "16px 0",
        width: "100%",
        maxWidth: "100%"
      }}>
        {currentPage === 'revenue' ? 
          <RevenuePage onSyncClick={() => setCurrentPage('sync')} /> : 
          <SyncPage onReturn={() => setCurrentPage('revenue')} />
        }
      </main>
    </div>
  );
}

export default App
