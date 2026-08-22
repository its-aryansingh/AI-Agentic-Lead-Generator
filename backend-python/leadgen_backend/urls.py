from django.urls import include, path

from leadgen_backend.api import views


urlpatterns = [
    path("health", views.health, name="health-root"),
    path("api/", include("leadgen_backend.api.urls")),
]

