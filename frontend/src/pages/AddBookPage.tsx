import { useNavigate } from 'react-router';
import { createBook } from '../api/books';
import { BookForm } from '../components/BookForm';
import { useTropes } from '../hooks/useTropes';
import { EMPTY_FORM, toCreatePayload } from '../lib/bookForm';
import { useToast } from '../toast/context';

export function AddBookPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const tropes = useTropes();

  return (
    <section className="narrow" aria-labelledby="add-heading">
      <h1 id="add-heading" className="page-title">
        Add a book
      </h1>
      <div className="card">
        <BookForm
          initialValues={EMPTY_FORM}
          submitLabel="Add book"
          submittingLabel="Adding…"
          onSubmit={async (values) => {
            const book = await createBook(toCreatePayload(values));
            toast.success(`Added “${book.title}” to your vault.`);
            navigate('/');
          }}
          onCancel={() => navigate(-1)}
          tropeSuggestions={tropes.map((t) => t.name)}
        />
      </div>
    </section>
  );
}
