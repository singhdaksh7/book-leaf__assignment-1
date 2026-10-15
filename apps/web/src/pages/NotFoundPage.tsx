import React from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, BookX } from "lucide-react";
import { Button } from "../components/common/Button";

export const NotFoundPage: React.FC = () => {
  return (
    <div className="min-h-[70vh] flex flex-col items-center justify-center text-center px-4">
      <div className="w-16 h-16 rounded-2xl bg-stone-100 flex items-center justify-center text-stone-400 mb-4 border border-stone-200">
        <BookX className="w-8 h-8" />
      </div>
      <h1 className="text-3xl font-bold tracking-tight text-stone-900 font-editorial">
        Page Not Found
      </h1>
      <p className="mt-2 text-sm text-stone-500 max-w-sm">
        The page or resource you requested does not exist or has been relocated in the BookLeaf portal.
      </p>
      <div className="mt-6">
        <Link to="/dashboard">
          <Button variant="primary" size="md" leftIcon={<ArrowLeft className="w-4 h-4" />}>
            Return to Dashboard
          </Button>
        </Link>
      </div>
    </div>
  );
};
