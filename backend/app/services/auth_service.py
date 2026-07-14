from app.core.database import supabase


class AuthService:

    def register(self, user):

        response = supabase.auth.sign_up({

            "email": user.email,

            "password": user.password,

            "options": {

                "data": {

                    "full_name": user.full_name,

                    "phone": user.phone

                }

            }

        })

        return response

    def verify_status(self, access_token):

        user = supabase.auth.get_user(access_token)

        return user