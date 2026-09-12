from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import pandas as pd
import pickle
from sklearn.metrics.pairwise import cosine_similarity


# --------------------------------------------------
# Load saved model/data
# --------------------------------------------------

df = pd.read_pickle("df.pkl")

with open("indices.pkl", "rb") as file:
    indices = pickle.load(file)

# --------------------------------------------------
# FIX: the dataset has duplicate movie titles (e.g. "The Avengers"
# appears twice). That makes indices["The Avengers"] return TWO row
# numbers instead of one, which breaks the similarity lookup below
# and crashes the /recommend endpoint with a 500 error for any
# duplicated title. Keeping only one row per title fixes it.
# --------------------------------------------------
indices = indices[~indices.index.duplicated(keep="last")]

with open("tfidf.pkl", "rb") as file:
    tfidf = pickle.load(file)

with open("tfidf_matrix.pkl", "rb") as file:
    tfidf_matrix = pickle.load(file)


# --------------------------------------------------
# FastAPI app
# --------------------------------------------------

app = FastAPI(
    title="Movie Recommendation API",
    description="Content-based movie recommendation system using NLP and TF-IDF",
    version="1.0.0"
)


# --------------------------------------------------
# CORS
# --------------------------------------------------

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --------------------------------------------------
# Home route
# --------------------------------------------------

@app.get("/")
def home():
    return {
        "message": "Movie Recommendation API is running!",
        "status": "success"
    }


# --------------------------------------------------
# Get movies
# --------------------------------------------------

@app.get("/movies")
def get_movies(search: str = ""):

    movies = df[["title", "vote_average", "popularity"]].copy()

    if search:
        movies = movies[
            movies["title"]
            .str.contains(search, case=False, na=False)
        ]

    movies = movies.head(20)

    return {
        "count": len(movies),
        "movies": movies.fillna(0).to_dict(orient="records")
    }


# --------------------------------------------------
# Recommendation function
# --------------------------------------------------

def recommend_movies(title: str, n: int = 10):

    # Exact title check
    if title not in indices:
        return None

    idx = indices[title]

    # Calculate cosine similarity
    similarity_scores = cosine_similarity(
        tfidf_matrix[idx],
        tfidf_matrix
    ).flatten()

    # Get most similar movies
    similar_indices = similarity_scores.argsort()[::-1][1:n + 1]

    recommendations = df.iloc[similar_indices][
        ["title", "genres", "overview", "tagline", "vote_average", "popularity"]
    ].copy()

    recommendations["similarity_score"] = similarity_scores[similar_indices]

    return recommendations.fillna("").to_dict(orient="records")


# --------------------------------------------------
# Recommendation API
# --------------------------------------------------

@app.get("/recommend/{title}")
def get_recommendations(title: str, n: int = 10):

    recommendations = recommend_movies(title, n)

    if recommendations is None:
        raise HTTPException(
            status_code=404,
            detail=f"Movie '{title}' not found in the dataset."
        )

    return {
        "movie": title,
        "recommendations": recommendations
    }