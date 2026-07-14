"use client";

import { useState } from "react";
import { register } from "../../services/authService";

export default function Register() {

    const [form, setForm] = useState({

        full_name: "",

        email: "",

        phone: "",

        password: ""

    });

    const submit = async () => {

        try {

            const res = await register(form);

            alert(res.data.message);

        } catch {

            alert("Registration Failed");

        }

    };

    return (

        <div>

            <h1>Recruiter Registration</h1>

            <input
                placeholder="Full Name"
                onChange={(e)=>setForm({...form,full_name:e.target.value})}
            />

            <input
                placeholder="Email"
                onChange={(e)=>setForm({...form,email:e.target.value})}
            />

            <input
                placeholder="Phone"
                onChange={(e)=>setForm({...form,phone:e.target.value})}
            />

            <input
                type="password"
                placeholder="Password"
                onChange={(e)=>setForm({...form,password:e.target.value})}
            />

            <button onClick={submit}>

                Register

            </button>

        </div>

    );

}