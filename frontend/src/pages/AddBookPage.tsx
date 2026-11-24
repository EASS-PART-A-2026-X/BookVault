import { useNavigate } from 'react-router';
import { createBook } from '../api/books';
import { BookForm } from '../components/BookForm';
import { EMPTY_FORM, toCreatePayload } from '../lib/bookForm';

export function AddBookPage() {
  const navigate = useNavigate();

  return (
    <section className="narrow" aria-labelledby="add-heading">
      <h1 id="add-heading">Add a book</h1>
      <div className="card">
        <BookForm
          initialValues={EMPTY_FORM}
          submitLabel="Add book"
          onSubmit={async (values) => {
            await createBook(toCreatePayload(values));
            navigate('/');
          }}
          onCancel={() => navigate(-1)}
        />
      </div>
    </section>
  );
}
